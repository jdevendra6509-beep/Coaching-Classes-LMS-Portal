import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DiscountType, EnrollmentStatus, InvoiceStatus, type Prisma, Role } from "@lms/db";
import { startOfToday } from "../academics/enroll.js";
import { AuditService } from "../audit/audit.service.js";
import { actorMembership, actorStudent } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import { nextDocumentNumber } from "../common/sequence.js";
import { MailService } from "../mail/mail.service.js";
import { toDate } from "../people/people.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import type { ApplyDiscountDto, CreateInvoiceDto, EnrollmentInvoiceDto, InvoicesQuery, PaymentsQuery, RecordPaymentDto } from "./dto.js";
import { checkInstallments, computeTotals, type LineInput, overdueAmount, rupeesInWords } from "./invoice-math.js";
import { LedgerService, SYS } from "./ledger.service.js";
import { D, type Decimal, type MoneyValue, round2, ZERO } from "./money.js";

const STUDENT_BRIEF = {
  id: true,
  admissionNo: true,
  guardianEmail: true,
  membership: { select: { user: { select: { name: true, email: true, phone: true } } } },
} as const;

const INVOICE_VIEW = {
  id: true,
  number: true,
  status: true,
  issueDate: true,
  dueDate: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  amountPaid: true,
  notes: true,
  issuedAt: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  student: { select: STUDENT_BRIEF },
  enrollment: { select: { id: true, course: { select: { id: true, code: true, name: true } }, batch: { select: { id: true, name: true } } } },
  lines: { select: { description: true, quantity: true, unitPrice: true, taxRate: true, amount: true } },
  discounts: { select: { description: true, amount: true, discountId: true } },
  installments: { orderBy: { dueDate: "asc" }, select: { dueDate: true, amount: true } },
  payments: {
    orderBy: { receivedAt: "asc" },
    select: { id: true, receiptNo: true, amount: true, method: true, reference: true, receivedAt: true, reversedAt: true, reversalReason: true },
  },
} as const satisfies Prisma.StudentInvoiceSelect;

type InvoiceRow = Prisma.StudentInvoiceGetPayload<{ select: typeof INVOICE_VIEW }>;

const OPEN: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID];

/** Adds what screens need but the table doesn't store: outstanding and overdue amounts. */
export function invoiceView(inv: InvoiceRow, today = startOfToday()) {
  const open = OPEN.includes(inv.status);
  return {
    ...inv,
    outstanding: open ? D(inv.total).sub(inv.amountPaid).toFixed(2) : "0.00",
    overdue: open ? overdueAmount(inv, today).toFixed(2) : "0.00",
  };
}

function statusFor(total: MoneyValue, paid: Decimal): InvoiceStatus {
  if (paid.isZero()) return InvoiceStatus.ISSUED;
  return paid.gte(D(total)) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ── creating ──

  create(iid: string, dto: CreateInvoiceDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: dto.studentId } });
      if (!student) throw new NotFoundException("Student not found");
      let courseId: string | undefined;
      if (dto.enrollmentId) {
        const e = await tx.enrollment.findUnique({ where: { id: dto.enrollmentId } });
        if (!e || e.studentId !== dto.studentId) throw new BadRequestException("That enrollment isn't this student's");
        courseId = e.courseId;
      }
      return this.build(tx, iid, auth, { ...dto, courseId });
    });
  }

  /** The usual case: bill an enrollment's course fee, once. */
  fromEnrollment(iid: string, dto: EnrollmentInvoiceDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const e = await tx.enrollment.findUnique({ where: { id: dto.enrollmentId }, include: { course: true, batch: true } });
      if (!e) throw new NotFoundException("Enrollment not found");
      if (e.status === EnrollmentStatus.DROPPED) throw new BadRequestException("This enrollment was dropped");
      const existing = await tx.studentInvoice.findFirst({ where: { enrollmentId: e.id, status: { not: InvoiceStatus.VOID } } });
      if (existing) throw new ConflictException(`This enrollment is already billed (${existing.number})`);
      if (D(e.course.fee).isZero()) throw new BadRequestException("This course has no fee");
      return this.build(tx, iid, auth, {
        ...dto,
        studentId: e.studentId,
        courseId: e.courseId,
        lines: [{ description: `Course fee: ${e.course.name} (${e.batch.name})`, quantity: 1, unitPrice: D(e.course.fee).toNumber(), taxRate: dto.taxRate }],
      });
    });
  }

  private async build(
    tx: Tx,
    iid: string,
    auth: AuthContext,
    input: Omit<CreateInvoiceDto, "lines"> & { lines: LineInput[]; courseId?: string },
  ) {
    const issueDate = toDate(input.issueDate) ?? startOfToday();
    const discounts = await this.resolveDiscounts(tx, input.discounts ?? [], input.lines, issueDate, input.courseId);
    const totals = computeTotals(input.lines, discounts.map((d) => d.amount));
    if (totals.total.isZero()) throw new BadRequestException("The invoice total is zero");

    const plan = (input.installments ?? []).map((i) => ({ dueDate: toDate(i.dueDate)!, amount: D(i.amount) }));
    checkInstallments(totals.total, plan);
    if (plan.length && plan[0].dueDate < issueDate) throw new BadRequestException("Instalments can't fall due before the issue date");
    const dueDate = plan.length ? plan[plan.length - 1].dueDate : toDate(input.dueDate);
    if (dueDate && dueDate < issueDate) throw new BadRequestException("The due date can't be before the issue date");

    const invoice = await tx.studentInvoice.create({
      data: {
        instituteId: iid,
        number: `DRAFT-${randomUUID().slice(0, 8)}`,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        issueDate,
        dueDate,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: input.notes,
        status: InvoiceStatus.DRAFT,
        // Nested rows get instituteId from the parent through their composite foreign keys.
        lines: { create: totals.lines },
        discounts: { create: discounts },
        installments: { create: plan },
      },
    });
    await this.audit.record({ action: "invoice.create", entityType: "StudentInvoice", entityId: invoice.id, instituteId: iid, actorUserId: auth.userId }, tx);
    if (input.issue !== false) await this.issueInTx(tx, iid, invoice.id, auth);
    return invoiceView(await tx.studentInvoice.findUniqueOrThrow({ where: { id: invoice.id }, select: INVOICE_VIEW }));
  }

  /** Rule discounts must be active, in date and for this course; each rule applies once. */
  private async resolveDiscounts(tx: Tx, requested: ApplyDiscountDto[], lines: LineInput[], on: Date, courseId?: string) {
    const subtotal = computeTotals(lines, []).subtotal;
    const seen = new Set<string>();
    const out: { discountId?: string; description: string; amount: Decimal }[] = [];
    for (const r of requested) {
      if (!r.discountId) {
        out.push({ description: r.description!, amount: D(r.amount!) });
        continue;
      }
      if (seen.has(r.discountId)) throw new BadRequestException("The same discount can only be applied once");
      seen.add(r.discountId);
      const rule = await tx.discount.findUnique({ where: { id: r.discountId } });
      if (!rule) throw new NotFoundException("Discount not found");
      if (!rule.isActive || (rule.validFrom && rule.validFrom > on) || (rule.validTo && rule.validTo < on)) {
        throw new BadRequestException(`"${rule.name}" isn't valid on this date`);
      }
      if (rule.courseId && rule.courseId !== courseId) throw new BadRequestException(`"${rule.name}" only applies to a different course`);
      const amount = rule.type === DiscountType.PERCENT ? round2(subtotal.mul(rule.value).div(100)) : D(rule.value);
      out.push({ discountId: rule.id, description: rule.type === DiscountType.PERCENT ? `${rule.name} (${D(rule.value).toString()}%)` : rule.name, amount });
    }
    return out;
  }

  issue(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await this.issueInTx(tx, iid, id, auth);
      return invoiceView(await tx.studentInvoice.findUniqueOrThrow({ where: { id }, select: INVOICE_VIEW }));
    });
  }

  /**
   * Numbers the invoice (gap-free, only now) and posts it:
   * Dr Accounts Receivable (total) / Cr Fee Income (after discounts) / Cr GST Payable (tax).
   */
  private async issueInTx(tx: Tx, iid: string, id: string, auth: AuthContext) {
    const inv = await this.lock(tx, id);
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException("Only drafts can be issued");
    const number = await nextDocumentNumber(tx, iid, "INVOICE");
    const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
    await tx.studentInvoice.update({ where: { id }, data: { number, status: InvoiceStatus.ISSUED, issuedAt: new Date() } });
    await this.ledger.post(tx, iid, {
      date: inv.issueDate,
      memo: `Invoice ${number}`,
      sourceType: "StudentInvoice",
      sourceId: id,
      postedById: by.id,
      lines: [
        { accountId: await this.ledger.systemAccount(tx, SYS.RECEIVABLE), debit: D(inv.total) },
        { accountId: await this.ledger.systemAccount(tx, SYS.FEE_INCOME), credit: D(inv.subtotal).sub(inv.discountTotal) },
        { accountId: await this.ledger.systemAccount(tx, SYS.GST_PAYABLE), credit: D(inv.taxTotal) },
      ],
    });
    await this.audit.record({ action: "invoice.issue", entityType: "StudentInvoice", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { number } }, tx);
  }

  deleteDraft(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const inv = await this.lock(tx, id);
      if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException("Issued invoices can't be deleted; void them instead");
      await tx.studentInvoice.delete({ where: { id } });
      await this.audit.record({ action: "invoice.delete_draft", entityType: "StudentInvoice", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
    });
  }

  /** Cancels an issued, unpaid invoice with a reversing journal entry. The number stays used. */
  void(iid: string, id: string, reason: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const inv = await this.lock(tx, id);
      if (inv.status === InvoiceStatus.DRAFT) throw new BadRequestException("Drafts are deleted, not voided");
      if (inv.status === InvoiceStatus.VOID) throw new BadRequestException("Already void");
      if (!D(inv.amountPaid).isZero()) throw new BadRequestException("Reverse the payments on this invoice before voiding it");
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const entry = await this.ledger.sourceEntry(tx, "StudentInvoice", id);
      if (entry) await this.ledger.reverse(tx, iid, entry.id, { date: startOfToday(), memo: `Void ${inv.number}: ${reason}`, postedById: by.id });
      await tx.studentInvoice.update({ where: { id }, data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: reason } });
      await this.audit.record({ action: "invoice.void", entityType: "StudentInvoice", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { reason } }, tx);
      return invoiceView(await tx.studentInvoice.findUniqueOrThrow({ where: { id }, select: INVOICE_VIEW }));
    });
  }

  // ── reading ──

  list(iid: string, q: InvoicesQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.StudentInvoiceWhereInput = {
        status: q.overdue ? { in: OPEN } : q.status,
        studentId: q.studentId,
        enrollmentId: q.enrollmentId,
        ...(q.search && {
          OR: [
            { number: { contains: q.search, mode: "insensitive" } },
            { student: { admissionNo: { contains: q.search, mode: "insensitive" } } },
            { student: { membership: { user: { name: { contains: q.search, mode: "insensitive" } } } } },
          ],
        }),
      };
      if (q.overdue) {
        // Overdue depends on the instalment schedule, so it's worked out here rather than in SQL.
        const today = startOfToday();
        const all = (await tx.studentInvoice.findMany({ where, select: INVOICE_VIEW, orderBy: { dueDate: "asc" } }))
          .map((i) => invoiceView(i, today))
          .filter((i) => D(i.overdue).gt(0));
        return { items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: all.length, page: q.page, pageSize: q.pageSize };
      }
      const items = await tx.studentInvoice.findMany({ where, select: INVOICE_VIEW, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize });
      const total = await tx.studentInvoice.count({ where });
      return { items: items.map((i) => invoiceView(i)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(iid: string, id: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const inv = await tx.studentInvoice.findUnique({ where: { id }, select: INVOICE_VIEW });
      if (!inv) throw new NotFoundException();
      return invoiceView(inv);
    });
  }

  /** Billed / paid / outstanding / overdue for one student, with their invoices. */
  studentFees(iid: string, studentId: string) {
    return this.prisma.tenant(iid, async (tx) => {
      if (!(await tx.student.findUnique({ where: { id: studentId } }))) throw new NotFoundException();
      return this.feeSummary(tx, studentId);
    });
  }

  myFees(iid: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => this.feeSummary(tx, (await actorStudent(tx, auth)).id));
  }

  private async feeSummary(tx: Tx, studentId: string) {
    const rows = await tx.studentInvoice.findMany({
      where: { studentId, status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID] } },
      select: INVOICE_VIEW,
      orderBy: { issueDate: "desc" },
    });
    const invoices = rows.map((r) => invoiceView(r));
    const add = (f: (i: (typeof invoices)[number]) => MoneyValue) => invoices.reduce((a, i) => a.add(D(f(i))), ZERO).toFixed(2);
    return {
      billed: add((i) => i.total),
      paid: add((i) => i.amountPaid),
      outstanding: add((i) => i.outstanding),
      overdue: add((i) => i.overdue),
      invoices,
    };
  }

  // ── payments ──

  /**
   * Records money received against an invoice and posts Dr Cash/Bank / Cr Receivable. The
   * invoice row is locked, so two payments entered at once can't together exceed what's owed.
   */
  async recordPayment(iid: string, invoiceId: string, dto: RecordPaymentDto, auth: AuthContext) {
    const result = await this.prisma.tenant(iid, async (tx) => {
      const inv = await this.lock(tx, invoiceId);
      if (!OPEN.includes(inv.status)) throw new BadRequestException(`Payments can't be recorded on a ${inv.status.toLowerCase()} invoice`);
      const amount = D(dto.amount);
      const outstanding = D(inv.total).sub(inv.amountPaid);
      if (amount.gt(outstanding)) throw new BadRequestException(`Only ${outstanding.toFixed(2)} is outstanding on this invoice`);
      const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
      if (receivedAt.getTime() > Date.now() + 60_000) throw new BadRequestException("Payment date can't be in the future");

      const accountId = await this.ledger.moneyAccount(tx, dto.method, dto.accountId);
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const receiptNo = await nextDocumentNumber(tx, iid, "RECEIPT");
      const payment = await tx.studentPayment.create({
        data: {
          instituteId: iid,
          receiptNo,
          invoiceId,
          studentId: inv.studentId,
          amount,
          method: dto.method,
          reference: dto.reference,
          receivedAt,
          accountId,
          recordedById: by.id,
        },
      });
      await this.ledger.post(tx, iid, {
        date: receivedAt,
        memo: `Receipt ${receiptNo} for ${inv.number}`,
        sourceType: "StudentPayment",
        sourceId: payment.id,
        postedById: by.id,
        lines: [
          { accountId, debit: amount },
          { accountId: await this.ledger.systemAccount(tx, SYS.RECEIVABLE), credit: amount },
        ],
      });
      const paid = D(inv.amountPaid).add(amount);
      await tx.studentInvoice.update({ where: { id: invoiceId }, data: { amountPaid: paid, status: statusFor(inv.total, paid) } });
      await this.audit.record({ action: "payment.record", entityType: "StudentPayment", entityId: payment.id, instituteId: iid, actorUserId: auth.userId, metadata: { amount: amount.toFixed(2), method: dto.method } }, tx);
      return { paymentId: payment.id, receipt: await this.receiptData(tx, payment.id) };
    });
    if (dto.sendReceipt !== false) await this.emailReceipt(result.receipt);
    return result.receipt;
  }

  /** Undoes a payment that didn't go through (e.g. a bounced cheque); the receipt number stays used. */
  reversePayment(iid: string, paymentId: string, reason: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const payment = await tx.studentPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException();
      const inv = await this.lock(tx, payment.invoiceId);
      // Re-read under the invoice lock so two reversals of one payment can't both pass.
      const fresh = await tx.studentPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (fresh.reversedAt) throw new BadRequestException("This payment has already been reversed");
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const entry = await this.ledger.sourceEntry(tx, "StudentPayment", paymentId);
      if (entry) await this.ledger.reverse(tx, iid, entry.id, { date: startOfToday(), memo: `Reversal of ${payment.receiptNo}: ${reason}`, postedById: by.id });
      await tx.studentPayment.update({ where: { id: paymentId }, data: { reversedAt: new Date(), reversalReason: reason } });
      const paid = D(inv.amountPaid).sub(payment.amount);
      await tx.studentInvoice.update({ where: { id: inv.id }, data: { amountPaid: paid, status: statusFor(inv.total, paid) } });
      await this.audit.record({ action: "payment.reverse", entityType: "StudentPayment", entityId: paymentId, instituteId: iid, actorUserId: auth.userId, metadata: { reason } }, tx);
      return this.receiptData(tx, paymentId);
    });
  }

  listPayments(iid: string, q: PaymentsQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.StudentPaymentWhereInput = {
        method: q.method,
        studentId: q.studentId,
        receivedAt: { gte: toDate(q.from), lt: q.to ? new Date(toDate(q.to)!.getTime() + 86_400_000) : undefined },
      };
      const items = await tx.studentPayment.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, receiptNo: true, amount: true, method: true, reference: true, receivedAt: true, reversedAt: true,
          invoice: { select: { id: true, number: true } },
          student: { select: STUDENT_BRIEF },
          account: { select: { code: true, name: true } },
        },
      });
      const total = await tx.studentPayment.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  receipt(iid: string, paymentId: string) {
    return this.prisma.tenant(iid, (tx) => this.receiptData(tx, paymentId));
  }

  myReceipt(iid: string, paymentId: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const me = await actorStudent(tx, auth);
      const p = await tx.studentPayment.findUnique({ where: { id: paymentId } });
      if (!p || p.studentId !== me.id) throw new NotFoundException();
      return this.receiptData(tx, paymentId);
    });
  }

  /** Everything a printed fee receipt shows. */
  private async receiptData(tx: Tx, paymentId: string) {
    const p = await tx.studentPayment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: { select: { id: true, number: true, total: true, amountPaid: true, status: true } },
        student: { select: STUDENT_BRIEF },
      },
    });
    if (!p) throw new NotFoundException();
    const institute = await tx.institute.findUniqueOrThrow({
      where: { id: p.instituteId },
      select: { name: true, legalName: true, gstin: true, address: true, city: true, state: true, pincode: true, phone: true, email: true },
    });
    return {
      id: p.id,
      receiptNo: p.receiptNo,
      receivedAt: p.receivedAt,
      amount: D(p.amount).toFixed(2),
      amountInWords: rupeesInWords(p.amount),
      method: p.method,
      reference: p.reference,
      reversed: !!p.reversedAt,
      reversalReason: p.reversalReason,
      institute,
      student: { name: p.student.membership.user.name, admissionNo: p.student.admissionNo, email: p.student.membership.user.email, guardianEmail: p.student.guardianEmail },
      invoice: { ...p.invoice, total: D(p.invoice.total).toFixed(2), balance: D(p.invoice.total).sub(p.invoice.amountPaid).toFixed(2) },
    };
  }

  private async emailReceipt(r: Awaited<ReturnType<InvoicesService["receiptData"]>>) {
    const text =
      `Dear ${r.student.name},\n\nWe have received ${r.amount} (${r.amountInWords}) by ${r.method.replace("_", " ").toLowerCase()}` +
      `${r.reference ? `, reference ${r.reference}` : ""}, against invoice ${r.invoice.number}.\n\n` +
      `Receipt no: ${r.receiptNo}\nDate: ${r.receivedAt.toISOString().slice(0, 10)}\nBalance due on this invoice: ${r.invoice.balance}\n\n` +
      `${r.institute.name}`;
    for (const to of new Set([r.student.email, r.student.guardianEmail].filter((e): e is string => !!e))) {
      await this.mail.send({ to, subject: `Fee receipt ${r.receiptNo} - ${r.institute.name}`, text }).catch(() => this.logger.warn("Receipt email not sent"));
    }
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "StudentInvoice" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Invoice not found");
    return tx.studentInvoice.findUniqueOrThrow({ where: { id } });
  }
}

/**
 * The fee half of the certificate rule. True when every issued invoice for the enrollment is
 * fully paid and nothing is left as a draft. A course with a fee must have been billed: an
 * unbilled paid course is treated as not cleared, so a forgotten invoice can't release a
 * certificate. Free courses (fee 0) are cleared without an invoice.
 */
export async function enrollmentFeesCleared(tx: Tx, enrollmentId: string): Promise<boolean> {
  const e = await tx.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: { select: { fee: true } } } });
  if (!e) return false;
  const invoices = await tx.studentInvoice.findMany({ where: { enrollmentId, status: { not: InvoiceStatus.VOID } }, select: { status: true } });
  if (!invoices.length) return D(e.course.fee).isZero();
  return invoices.every((i) => i.status === InvoiceStatus.PAID);
}
