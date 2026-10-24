import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountType, InvoiceStatus, type Prisma, Role } from "@lms/db";
import { startOfToday } from "../academics/enroll.js";
import { AuditService } from "../audit/audit.service.js";
import { actorMembership } from "../common/actor.js";
import { skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { toDate } from "../people/people.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import type { BillsQuery, CreateBillDto, PayBillDto, UpdateVendorDto, VendorDto } from "./dto.js";
import { LedgerService, SYS } from "./ledger.service.js";
import { D, type Decimal, type MoneyValue } from "./money.js";
import type { PageQuery } from "../common/pagination.js";

const BILL_VIEW = {
  id: true,
  billNumber: true,
  billDate: true,
  dueDate: true,
  description: true,
  total: true,
  amountPaid: true,
  status: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  vendor: { select: { id: true, name: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
  payments: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, method: true, reference: true, paidAt: true } },
} as const satisfies Prisma.BillSelect;

const OPEN: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID];

/** Accounts payable: what the institute owes its vendors (rent, salaries via agencies, printing…). */
@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  listVendors(iid: string, q: PageQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.VendorWhereInput = q.search ? { name: { contains: q.search, mode: "insensitive" } } : {};
      const items = await tx.vendor.findMany({ where, orderBy: { name: "asc" }, ...skipTake(q) });
      const total = await tx.vendor.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  createVendor(iid: string, dto: VendorDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const v = await tx.vendor.create({ data: { instituteId: iid, ...dto } });
      await this.audit.record({ action: "vendor.create", entityType: "Vendor", entityId: v.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return v;
    });
  }

  updateVendor(iid: string, id: string, dto: UpdateVendorDto) {
    return this.prisma.tenant(iid, (tx) => tx.vendor.update({ where: { id }, data: dto }));
  }

  listBills(iid: string, q: BillsQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.BillWhereInput = {
        vendorId: q.vendorId,
        status: q.status,
        ...(q.search && { OR: [{ billNumber: { contains: q.search, mode: "insensitive" } }, { vendor: { name: { contains: q.search, mode: "insensitive" } } }] }),
      };
      const items = await tx.bill.findMany({ where, select: BILL_VIEW, orderBy: { billDate: "desc" }, ...skipTake(q) });
      const total = await tx.bill.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  getBill(iid: string, id: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const b = await tx.bill.findUnique({ where: { id }, select: BILL_VIEW });
      if (!b) throw new NotFoundException();
      return b;
    });
  }

  /** Records a vendor bill and posts Dr Expense / Cr Accounts Payable. */
  createBill(iid: string, dto: CreateBillDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (!(await tx.vendor.findUnique({ where: { id: dto.vendorId } }))) throw new NotFoundException("Vendor not found");
      const expense = await tx.account.findUnique({ where: { id: dto.expenseAccountId } });
      if (!expense) throw new NotFoundException("Account not found");
      if (expense.type !== AccountType.EXPENSE || !expense.isActive) throw new BadRequestException("Bills must be booked to an active expense account");
      if (await tx.bill.findFirst({ where: { vendorId: dto.vendorId, billNumber: dto.billNumber } })) {
        throw new ConflictException(`Bill ${dto.billNumber} from this vendor is already recorded`);
      }
      const billDate = toDate(dto.billDate)!;
      const dueDate = toDate(dto.dueDate);
      if (dueDate && dueDate < billDate) throw new BadRequestException("The due date can't be before the bill date");

      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const bill = await tx.bill.create({
        data: {
          instituteId: iid,
          vendorId: dto.vendorId,
          billNumber: dto.billNumber,
          billDate,
          dueDate,
          expenseAccountId: expense.id,
          description: dto.description,
          total: D(dto.total),
        },
      });
      await this.ledger.post(tx, iid, {
        date: billDate,
        memo: `Bill ${dto.billNumber}`,
        sourceType: "Bill",
        sourceId: bill.id,
        postedById: by.id,
        lines: [
          { accountId: expense.id, debit: D(dto.total) },
          { accountId: await this.ledger.systemAccount(tx, SYS.PAYABLE), credit: D(dto.total) },
        ],
      });
      await this.audit.record({ action: "bill.create", entityType: "Bill", entityId: bill.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, select: BILL_VIEW });
    });
  }

  /** Pays (part of) a bill: Dr Accounts Payable / Cr Cash/Bank. */
  payBill(iid: string, id: string, dto: PayBillDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const bill = await this.lock(tx, id);
      if (!OPEN.includes(bill.status)) throw new BadRequestException(`This bill is ${bill.status.toLowerCase()}`);
      const amount = D(dto.amount);
      const outstanding = D(bill.total).sub(bill.amountPaid);
      if (amount.gt(outstanding)) throw new BadRequestException(`Only ${outstanding.toFixed(2)} is outstanding on this bill`);
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      if (paidAt.getTime() > Date.now() + 60_000) throw new BadRequestException("Payment date can't be in the future");
      const accountId = await this.ledger.moneyAccount(tx, dto.method, dto.accountId);
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);

      const payment = await tx.billPayment.create({
        data: { instituteId: iid, billId: id, amount, method: dto.method, reference: dto.reference, paidAt, accountId },
      });
      await this.ledger.post(tx, iid, {
        date: paidAt,
        memo: `Payment of bill ${bill.billNumber}`,
        sourceType: "BillPayment",
        sourceId: payment.id,
        postedById: by.id,
        lines: [
          { accountId: await this.ledger.systemAccount(tx, SYS.PAYABLE), debit: amount },
          { accountId, credit: amount },
        ],
      });
      const paid = D(bill.amountPaid).add(amount);
      await tx.bill.update({ where: { id }, data: { amountPaid: paid, status: statusFor(bill.total, paid) } });
      await this.audit.record({ action: "bill.pay", entityType: "Bill", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { amount: amount.toFixed(2) } }, tx);
      return tx.bill.findUniqueOrThrow({ where: { id }, select: BILL_VIEW });
    });
  }

  voidBill(iid: string, id: string, reason: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const bill = await this.lock(tx, id);
      if (bill.status === InvoiceStatus.VOID) throw new BadRequestException("Already void");
      if (!D(bill.amountPaid).isZero()) throw new BadRequestException("A bill with payments can't be voided");
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const entry = await this.ledger.sourceEntry(tx, "Bill", id);
      if (entry) await this.ledger.reverse(tx, iid, entry.id, { date: startOfToday(), memo: `Void bill ${bill.billNumber}: ${reason}`, postedById: by.id });
      await tx.bill.update({ where: { id }, data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: reason } });
      await this.audit.record({ action: "bill.void", entityType: "Bill", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { reason } }, tx);
      return tx.bill.findUniqueOrThrow({ where: { id }, select: BILL_VIEW });
    });
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Bill" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Bill not found");
    return tx.bill.findUniqueOrThrow({ where: { id } });
  }
}

function statusFor(total: MoneyValue, paid: Decimal): InvoiceStatus {
  if (paid.isZero()) return InvoiceStatus.ISSUED;
  return paid.gte(D(total)) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
}
