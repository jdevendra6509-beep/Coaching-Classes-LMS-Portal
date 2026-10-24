import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import { PageQuery } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { toDate } from "../people/people.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountsService } from "./accounts.service.js";
import {
  AsOfQuery, BillsQuery, CreateAccountDto, CreateBillDto, CreateDiscountDto, CreateInvoiceDto, DateRangeQuery, EnrollmentInvoiceDto,
  InvoicesQuery, JournalsQuery, ManualJournalDto, PayBillDto, PaymentsQuery, RecordPaymentDto, UpdateAccountDto, UpdateDiscountDto,
  UpdateVendorDto, VendorDto, VoidDto,
} from "./dto.js";
import { InvoicesService } from "./invoices.service.js";
import { PayablesService } from "./payables.service.js";
import { ReportsService } from "./reports.service.js";

const FINANCE = [Role.INSTITUTE_ADMIN, Role.ACCOUNTANT];

@Roles(...FINANCE)
@Controller()
export class FinanceController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payables: PayablesService,
    private readonly accounts: AccountsService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── invoices & payments ──

  @Get("invoices")
  listInvoices(@InstituteId() iid: string, @Query() q: InvoicesQuery) {
    return this.invoices.list(iid, q);
  }

  @Post("invoices")
  createInvoice(@InstituteId() iid: string, @Body() dto: CreateInvoiceDto, @Auth() auth: AuthContext) {
    return this.invoices.create(iid, dto, auth);
  }

  /** Bill an enrollment's course fee (optionally in instalments, with discounts). */
  @Post("invoices/from-enrollment")
  fromEnrollment(@InstituteId() iid: string, @Body() dto: EnrollmentInvoiceDto, @Auth() auth: AuthContext) {
    return this.invoices.fromEnrollment(iid, dto, auth);
  }

  @Get("invoices/:id")
  getInvoice(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.get(iid, id);
  }

  @Post("invoices/:id/issue")
  @HttpCode(200)
  issue(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.invoices.issue(iid, id, auth);
  }

  @Delete("invoices/:id")
  @HttpCode(204)
  deleteDraft(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.invoices.deleteDraft(iid, id, auth);
  }

  @Post("invoices/:id/void")
  @HttpCode(200)
  voidInvoice(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VoidDto, @Auth() auth: AuthContext) {
    return this.invoices.void(iid, id, dto.reason, auth);
  }

  @Post("invoices/:id/payments")
  recordPayment(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @Auth() auth: AuthContext) {
    return this.invoices.recordPayment(iid, id, dto, auth);
  }

  @Get("payments")
  payments(@InstituteId() iid: string, @Query() q: PaymentsQuery) {
    return this.invoices.listPayments(iid, q);
  }

  @Get("payments/:id/receipt")
  receipt(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.receipt(iid, id);
  }

  /** For a payment that didn't go through, e.g. a bounced cheque. */
  @Post("payments/:id/reverse")
  @HttpCode(200)
  reversePayment(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VoidDto, @Auth() auth: AuthContext) {
    return this.invoices.reversePayment(iid, id, dto.reason, auth);
  }

  @Get("students/:id/fees")
  studentFees(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.studentFees(iid, id);
  }

  // ── discounts ──

  @Get("discounts")
  discounts(@InstituteId() iid: string) {
    return this.prisma.tenant(iid, (tx) =>
      tx.discount.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { course: { select: { id: true, code: true, name: true } } } }),
    );
  }

  @Post("discounts")
  createDiscount(@InstituteId() iid: string, @Body() dto: CreateDiscountDto, @Auth() auth: AuthContext) {
    if (dto.type === "PERCENT" && dto.value > 100) throw new BadRequestException("A percentage discount can't exceed 100");
    const validFrom = toDate(dto.validFrom);
    const validTo = toDate(dto.validTo);
    if (validFrom && validTo && validTo < validFrom) throw new BadRequestException("validTo must be on or after validFrom");
    return this.prisma.tenant(iid, async (tx) => {
      if (dto.courseId && !(await tx.course.findUnique({ where: { id: dto.courseId } }))) throw new NotFoundException("Course not found");
      const d = await tx.discount.create({ data: { instituteId: iid, name: dto.name, type: dto.type, value: dto.value, courseId: dto.courseId, validFrom, validTo } });
      await this.audit.record({ action: "discount.create", entityType: "Discount", entityId: d.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return d;
    });
  }

  /** Type and value are fixed once created (invoices keep what they applied); deactivate and create a new one instead. */
  @Patch("discounts/:id")
  updateDiscount(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDiscountDto, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const d = await tx.discount.update({
        where: { id },
        data: { name: dto.name, isActive: dto.isActive, validFrom: toDate(dto.validFrom), validTo: toDate(dto.validTo) },
      });
      await this.audit.record({ action: "discount.update", entityType: "Discount", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return d;
    });
  }

  // ── payables ──

  @Get("vendors")
  vendors(@InstituteId() iid: string, @Query() q: PageQuery) {
    return this.payables.listVendors(iid, q);
  }

  @Post("vendors")
  createVendor(@InstituteId() iid: string, @Body() dto: VendorDto, @Auth() auth: AuthContext) {
    return this.payables.createVendor(iid, dto, auth);
  }

  @Patch("vendors/:id")
  updateVendor(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto) {
    return this.payables.updateVendor(iid, id, dto);
  }

  @Get("bills")
  bills(@InstituteId() iid: string, @Query() q: BillsQuery) {
    return this.payables.listBills(iid, q);
  }

  @Post("bills")
  createBill(@InstituteId() iid: string, @Body() dto: CreateBillDto, @Auth() auth: AuthContext) {
    return this.payables.createBill(iid, dto, auth);
  }

  @Get("bills/:id")
  bill(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.payables.getBill(iid, id);
  }

  @Post("bills/:id/payments")
  payBill(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: PayBillDto, @Auth() auth: AuthContext) {
    return this.payables.payBill(iid, id, dto, auth);
  }

  @Post("bills/:id/void")
  @HttpCode(200)
  voidBill(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VoidDto, @Auth() auth: AuthContext) {
    return this.payables.voidBill(iid, id, dto.reason, auth);
  }

  // ── ledger ──

  @Get("accounts")
  chart(@InstituteId() iid: string) {
    return this.accounts.list(iid);
  }

  @Post("accounts")
  createAccount(@InstituteId() iid: string, @Body() dto: CreateAccountDto, @Auth() auth: AuthContext) {
    return this.accounts.create(iid, dto, auth);
  }

  @Patch("accounts/:id")
  updateAccount(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto, @Auth() auth: AuthContext) {
    return this.accounts.update(iid, id, dto, auth);
  }

  @Get("accounts/:id/ledger")
  ledger(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Query() q: DateRangeQuery) {
    return this.reports.accountLedger(iid, id, q.from, q.to);
  }

  @Get("journals")
  journals(@InstituteId() iid: string, @Query() q: JournalsQuery) {
    return this.accounts.journals(iid, q);
  }

  @Post("journals")
  manualJournal(@InstituteId() iid: string, @Body() dto: ManualJournalDto, @Auth() auth: AuthContext) {
    return this.accounts.postManual(iid, dto, auth);
  }

  @Post("journals/:id/reverse")
  @HttpCode(200)
  reverseJournal(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.accounts.reverseManual(iid, id, auth);
  }

  // ── reports ──

  @Get("reports/trial-balance")
  trialBalance(@InstituteId() iid: string, @Query() q: AsOfQuery) {
    return this.reports.trialBalance(iid, q.asOf);
  }

  @Get("reports/profit-and-loss")
  profitAndLoss(@InstituteId() iid: string, @Query() q: DateRangeQuery) {
    return this.reports.profitAndLoss(iid, q.from, q.to);
  }

  @Get("reports/balance-sheet")
  balanceSheet(@InstituteId() iid: string, @Query() q: AsOfQuery) {
    return this.reports.balanceSheet(iid, q.asOf);
  }

  @Get("reports/receivables-ageing")
  receivablesAgeing(@InstituteId() iid: string, @Query() q: AsOfQuery) {
    return this.reports.receivablesAgeing(iid, q.asOf);
  }

  @Get("reports/payables-ageing")
  payablesAgeing(@InstituteId() iid: string, @Query() q: AsOfQuery) {
    return this.reports.payablesAgeing(iid, q.asOf);
  }

  @Get("reports/collections")
  collections(@InstituteId() iid: string, @Query() q: DateRangeQuery) {
    return this.reports.collections(iid, q.from, q.to);
  }
}

/** A student's own fees and receipts. */
@Roles(Role.STUDENT)
@Controller("me")
export class StudentFeesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get("fees")
  fees(@InstituteId() iid: string, @Auth() auth: AuthContext) {
    return this.invoices.myFees(iid, auth);
  }

  @Get("payments/:id/receipt")
  receipt(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.invoices.myReceipt(iid, id, auth);
  }
}
