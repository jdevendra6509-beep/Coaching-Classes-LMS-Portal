import { Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, type Prisma } from "@lms/db";
import { startOfToday } from "../academics/enroll.js";
import { toDate } from "../people/people.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { D, debitNormal, type Decimal, type MoneyValue, sum, ZERO } from "./money.js";

interface AccountTotals {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: Decimal;
  credit: Decimal;
}

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketFor(dueDate: Date, asOf: Date): Bucket {
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, ZERO])) as Record<Bucket, Decimal>;
const fixed = (b: Record<Bucket, Decimal>) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toFixed(2)])) as Record<Bucket, string>;

/**
 * Splits what's still owed into due-date slices: payments settle the earliest instalments
 * first, and whatever remains of each instalment ages from its own due date.
 */
export function openSlices(total: MoneyValue, paid: MoneyValue, schedule: { dueDate: Date; amount: MoneyValue }[], fallbackDue: Date) {
  const plan = schedule.length ? schedule : [{ dueDate: fallbackDue, amount: total }];
  let credit = D(paid);
  const out: { dueDate: Date; amount: Decimal }[] = [];
  for (const p of plan) {
    const covered = minOf(D(p.amount), credit);
    credit = credit.sub(covered);
    const open = D(p.amount).sub(covered);
    if (open.gt(0)) out.push({ dueDate: p.dueDate, amount: open });
  }
  return out;
}
const minOf = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every account's debit and credit totals up to a date; the two columns always agree. */
  trialBalance(iid: string, asOf?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const date = toDate(asOf) ?? startOfToday();
      const rows = await totalsByAccount(tx, null, date);
      const accounts = rows
        .filter((r) => !r.debit.isZero() || !r.credit.isZero())
        .map((r) => {
          const net = r.debit.sub(r.credit);
          return { ...r, debit: net.gt(0) ? net.toFixed(2) : "0.00", credit: net.lt(0) ? net.neg().toFixed(2) : "0.00" };
        });
      return {
        asOf: date.toISOString().slice(0, 10),
        accounts,
        totalDebit: sum(accounts.map((a) => D(a.debit))).toFixed(2),
        totalCredit: sum(accounts.map((a) => D(a.credit))).toFixed(2),
      };
    });
  }

  profitAndLoss(iid: string, from?: string, to?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const end = toDate(to) ?? startOfToday();
      const start = toDate(from) ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      const rows = await totalsByAccount(tx, start, end);
      const pick = (type: string) =>
        rows
          .filter((r) => r.type === type)
          .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: type === "INCOME" ? r.credit.sub(r.debit) : r.debit.sub(r.credit) }))
          .filter((r) => !r.amount.isZero());
      const income = pick("INCOME");
      const expenses = pick("EXPENSE");
      const totalIncome = sum(income.map((i) => i.amount));
      const totalExpenses = sum(expenses.map((e) => e.amount));
      const str = (xs: typeof income) => xs.map((x) => ({ ...x, amount: x.amount.toFixed(2) }));
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        income: str(income),
        expenses: str(expenses),
        totalIncome: totalIncome.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netProfit: totalIncome.sub(totalExpenses).toFixed(2),
      };
    });
  }

  /** Assets = Liabilities + Equity, with the year-to-date profit shown as retained earnings. */
  balanceSheet(iid: string, asOf?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const date = toDate(asOf) ?? startOfToday();
      const rows = await totalsByAccount(tx, null, date);
      const section = (type: string) =>
        rows
          .filter((r) => r.type === type)
          .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: debitNormal(type) ? r.debit.sub(r.credit) : r.credit.sub(r.debit) }))
          .filter((r) => !r.amount.isZero());
      const assets = section("ASSET");
      const liabilities = section("LIABILITY");
      const equity = section("EQUITY");
      const retained = sum(section("INCOME").map((r) => r.amount)).sub(sum(section("EXPENSE").map((r) => r.amount)));
      const totalAssets = sum(assets.map((a) => a.amount));
      const totalLiabilities = sum(liabilities.map((a) => a.amount));
      const totalEquity = sum(equity.map((a) => a.amount)).add(retained);
      const str = (xs: typeof assets) => xs.map((x) => ({ ...x, amount: x.amount.toFixed(2) }));
      return {
        asOf: date.toISOString().slice(0, 10),
        assets: str(assets),
        liabilities: str(liabilities),
        equity: [...str(equity), { id: null, code: null, name: "Retained earnings (profit to date)", amount: retained.toFixed(2) }],
        totalAssets: totalAssets.toFixed(2),
        totalLiabilities: totalLiabilities.toFixed(2),
        totalEquity: totalEquity.toFixed(2),
        balanced: totalAssets.eq(totalLiabilities.add(totalEquity)),
      };
    });
  }

  /** One account's statement: opening balance, each movement with a running balance, closing balance. */
  accountLedger(iid: string, accountId: string, from?: string, to?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundException();
      const end = toDate(to) ?? startOfToday();
      const start = toDate(from) ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      const sign = debitNormal(account.type) ? 1 : -1;
      const before = await tx.journalLine.aggregate({ where: { accountId, entry: { date: { lt: start } } }, _sum: { debit: true, credit: true } });
      let balance = D(before._sum.debit ?? 0).sub(before._sum.credit ?? 0).mul(sign);
      const opening = balance;
      const lines = await tx.journalLine.findMany({
        where: { accountId, entry: { date: { gte: start, lte: end } } },
        orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
        select: { debit: true, credit: true, entry: { select: { id: true, date: true, memo: true, sourceType: true, sourceId: true } } },
      });
      const movements = lines.map((l) => {
        balance = balance.add(D(l.debit).sub(l.credit).mul(sign));
        return { ...l.entry, date: l.entry.date.toISOString().slice(0, 10), debit: D(l.debit).toFixed(2), credit: D(l.credit).toFixed(2), balance: balance.toFixed(2) };
      });
      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        opening: opening.toFixed(2),
        movements,
        closing: balance.toFixed(2),
      };
    });
  }

  /** Who owes fees, and for how long, per student. */
  receivablesAgeing(iid: string, asOf?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const date = toDate(asOf) ?? startOfToday();
      const invoices = await tx.studentInvoice.findMany({
        where: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] }, issueDate: { lte: date } },
        select: {
          id: true, number: true, total: true, amountPaid: true, dueDate: true, issueDate: true,
          installments: { orderBy: { dueDate: "asc" }, select: { dueDate: true, amount: true } },
          student: { select: { id: true, admissionNo: true, membership: { select: { user: { select: { name: true, phone: true } } } } } },
        },
      });
      const byStudent = new Map<string, { studentId: string; name: string; admissionNo: string; phone: string | null; buckets: Record<Bucket, Decimal>; invoices: string[] }>();
      const totals = emptyBuckets();
      for (const inv of invoices) {
        const key = inv.student.id;
        const row = byStudent.get(key) ?? {
          studentId: key, name: inv.student.membership.user.name, admissionNo: inv.student.admissionNo, phone: inv.student.membership.user.phone, buckets: emptyBuckets(), invoices: [],
        };
        for (const s of openSlices(inv.total, inv.amountPaid, inv.installments, inv.dueDate ?? inv.issueDate)) {
          const b = bucketFor(s.dueDate, date);
          row.buckets[b] = row.buckets[b].add(s.amount);
          totals[b] = totals[b].add(s.amount);
        }
        row.invoices.push(inv.number);
        byStudent.set(key, row);
      }
      const rows = [...byStudent.values()]
        .map((r) => ({ ...r, total: sum(Object.values(r.buckets)).toFixed(2), buckets: fixed(r.buckets) }))
        .sort((a, b) => D(b.total).cmp(D(a.total)));
      return { asOf: date.toISOString().slice(0, 10), buckets: BUCKETS, rows, totals: fixed(totals), total: sum(Object.values(totals)).toFixed(2) };
    });
  }

  /** What the institute owes vendors, by how overdue it is. */
  payablesAgeing(iid: string, asOf?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const date = toDate(asOf) ?? startOfToday();
      const bills = await tx.bill.findMany({
        where: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] }, billDate: { lte: date } },
        select: { total: true, amountPaid: true, dueDate: true, billDate: true, vendor: { select: { id: true, name: true } } },
      });
      const byVendor = new Map<string, { vendorId: string; name: string; buckets: Record<Bucket, Decimal> }>();
      const totals = emptyBuckets();
      for (const bill of bills) {
        const row = byVendor.get(bill.vendor.id) ?? { vendorId: bill.vendor.id, name: bill.vendor.name, buckets: emptyBuckets() };
        const b = bucketFor(bill.dueDate ?? bill.billDate, date);
        const open = D(bill.total).sub(bill.amountPaid);
        row.buckets[b] = row.buckets[b].add(open);
        totals[b] = totals[b].add(open);
        byVendor.set(bill.vendor.id, row);
      }
      const rows = [...byVendor.values()].map((r) => ({ ...r, total: sum(Object.values(r.buckets)).toFixed(2), buckets: fixed(r.buckets) }));
      return { asOf: date.toISOString().slice(0, 10), buckets: BUCKETS, rows, totals: fixed(totals), total: sum(Object.values(totals)).toFixed(2) };
    });
  }

  /** Fees actually collected in a period, by payment method (reversed payments excluded). */
  collections(iid: string, from?: string, to?: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const end = toDate(to) ?? startOfToday();
      const start = toDate(from) ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      const groups = await tx.studentPayment.groupBy({
        by: ["method"],
        where: { reversedAt: null, receivedAt: { gte: start, lt: new Date(end.getTime() + 86_400_000) } },
        _sum: { amount: true },
        _count: true,
      });
      const byMethod = groups.map((g) => ({ method: g.method, count: g._count, amount: D(g._sum.amount ?? 0).toFixed(2) }));
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        byMethod,
        total: sum(byMethod.map((m) => D(m.amount))).toFixed(2),
        count: byMethod.reduce((n, m) => n + m.count, 0),
      };
    });
  }
}

/** Debit/credit totals for every account over [from, to] (from = null: since the beginning). */
async function totalsByAccount(tx: Tx, from: Date | null, to: Date): Promise<AccountTotals[]> {
  const rows = await tx.$queryRaw<{ id: string; code: string; name: string; type: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }[]>`
    SELECT a.id, a.code, a.name, a.type::text AS type, t.debit, t.credit
    FROM "Account" a
    LEFT JOIN (
      SELECT l."accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE e.date <= ${to}::date AND (${from}::date IS NULL OR e.date >= ${from}::date)
      GROUP BY l."accountId"
    ) t ON t."accountId" = a.id
    ORDER BY a.code`;
  return rows.map((r) => ({ ...r, debit: D(r.debit ?? 0), credit: D(r.credit ?? 0) }));
}
