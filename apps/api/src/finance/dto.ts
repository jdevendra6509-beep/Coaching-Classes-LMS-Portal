import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from "class-validator";
import { AccountType, DiscountType, InvoiceStatus, PaymentMethod } from "@lms/db";
import { PageQuery } from "../common/pagination.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const MONEY = { maxDecimalPlaces: 2 } as const;

// ── chart of accounts & journals ──

export class CreateAccountDto {
  @Matches(/^[0-9A-Z-]{1,10}$/, { message: "code must be up to 10 digits, capitals or -" })
  code: string;

  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional() @IsUUID()
  parentId?: string;
}

export class UpdateAccountDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class JournalLineDto {
  @IsUUID()
  accountId: string;

  @IsOptional() @IsNumber(MONEY) @Min(0)
  debit?: number;

  @IsOptional() @IsNumber(MONEY) @Min(0)
  credit?: number;
}

export class ManualJournalDto {
  @IsDateString({ strict: true })
  date: string;

  @Transform(trim) @IsString() @Length(3, 500)
  memo: string;

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class DateRangeQuery {
  @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @IsOptional() @IsDateString({ strict: true })
  to?: string;
}

export class AsOfQuery {
  @IsOptional() @IsDateString({ strict: true })
  asOf?: string;
}

export class JournalsQuery extends DateRangeQuery {
  @IsOptional() @IsUUID()
  accountId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize = 50;
}

// ── discounts ──

export class CreateDiscountDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @IsEnum(DiscountType)
  type: DiscountType;

  /** Percent (0–100) or rupees. */
  @IsNumber(MONEY) @Min(0.01)
  value: number;

  /** Limit to one course; omit for any course. */
  @IsOptional() @IsUUID()
  courseId?: string;

  @IsOptional() @IsDateString({ strict: true })
  validFrom?: string;

  @IsOptional() @IsDateString({ strict: true })
  validTo?: string;
}

export class UpdateDiscountDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @IsDateString({ strict: true })
  validFrom?: string;

  @IsOptional() @IsDateString({ strict: true })
  validTo?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ── invoices ──

export class InvoiceLineDto {
  @Transform(trim) @IsString() @Length(1, 300)
  description: string;

  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  quantity = 1;

  @IsNumber(MONEY) @Min(0)
  unitPrice: number;

  /** GST %, e.g. 18. Leave 0 if the institute isn't GST-registered. */
  @IsOptional() @IsNumber(MONEY) @Min(0) @Max(28)
  taxRate = 0;
}

/** Either a saved discount rule, or an ad-hoc amount with a reason. */
export class ApplyDiscountDto {
  @ValidateIf((o: ApplyDiscountDto) => o.amount === undefined)
  @IsUUID()
  discountId?: string;

  @ValidateIf((o: ApplyDiscountDto) => !o.discountId)
  @IsNumber(MONEY) @Min(0.01)
  amount?: number;

  @ValidateIf((o: ApplyDiscountDto) => !o.discountId)
  @Transform(trim) @IsString() @Length(3, 200)
  description?: string;
}

export class InstallmentDto {
  @IsDateString({ strict: true })
  dueDate: string;

  @IsNumber(MONEY) @Min(0.01)
  amount: number;
}

class InvoiceCommon {
  @IsOptional() @IsDateString({ strict: true })
  issueDate?: string;

  /** Single due date; or give `installments` for a schedule. */
  @IsOptional() @IsDateString({ strict: true })
  dueDate?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(24) @ValidateNested({ each: true }) @Type(() => InstallmentDto)
  installments?: InstallmentDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ApplyDiscountDto)
  discounts?: ApplyDiscountDto[];

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  notes?: string;

  /** false = save as draft (not posted, no number yet). */
  @IsOptional() @IsBoolean()
  issue = true;
}

export class CreateInvoiceDto extends InvoiceCommon {
  @IsUUID()
  studentId: string;

  @IsOptional() @IsUUID()
  enrollmentId?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}

/** Bills the course fee for an enrollment. */
export class EnrollmentInvoiceDto extends InvoiceCommon {
  @IsUUID()
  enrollmentId: string;

  @IsOptional() @IsNumber(MONEY) @Min(0) @Max(28)
  taxRate = 0;
}

export class VoidDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason: string;
}

export class InvoicesQuery extends PageQuery {
  @IsOptional() @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional() @IsUUID()
  studentId?: string;

  @IsOptional() @IsUUID()
  enrollmentId?: string;

  /** Only invoices with an amount past due today. */
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean()
  overdue?: boolean;
}

// ── payments ──

export class RecordPaymentDto {
  @IsNumber(MONEY) @Min(0.01)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** UTR, cheque number, transaction id. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  reference?: string;

  @IsOptional() @IsDateString()
  receivedAt?: string;

  /** Specific cash/bank account; defaults to Cash in Hand for cash, Bank otherwise. */
  @IsOptional() @IsUUID()
  accountId?: string;

  /** Email the receipt to the student (and guardian). Default true. */
  @IsOptional() @IsBoolean()
  sendReceipt?: boolean;
}

export class PaymentsQuery extends DateRangeQuery {
  @IsOptional() @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional() @IsUUID()
  studentId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize = 50;
}

// ── payables ──

export class VendorDto {
  @Transform(trim) @IsString() @Length(2, 200)
  name: string;

  @IsOptional() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: "gstin is not a valid GSTIN" })
  gstin?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  email?: string;

  @IsOptional() @Transform(trim) @Matches(/^\+?[0-9]{10,13}$/)
  phone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  address?: string;
}

export class UpdateVendorDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 200)
  name?: string;

  @IsOptional() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
  gstin?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  email?: string;

  @IsOptional() @Transform(trim) @Matches(/^\+?[0-9]{10,13}$/)
  phone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  address?: string;
}

export class CreateBillDto {
  @IsUUID()
  vendorId: string;

  /** The vendor's own invoice number. */
  @Transform(trim) @IsString() @Length(1, 60)
  billNumber: string;

  @IsDateString({ strict: true })
  billDate: string;

  @IsOptional() @IsDateString({ strict: true })
  dueDate?: string;

  /** An expense account, e.g. Rent (5100). */
  @IsUUID()
  expenseAccountId: string;

  @IsNumber(MONEY) @Min(0.01)
  total: number;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  description?: string;
}

export class PayBillDto {
  @IsNumber(MONEY) @Min(0.01)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  reference?: string;

  @IsOptional() @IsDateString()
  paidAt?: string;

  @IsOptional() @IsUUID()
  accountId?: string;
}

export class BillsQuery extends PageQuery {
  @IsOptional() @IsUUID()
  vendorId?: string;

  @IsOptional() @IsIn(["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"])
  status?: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
}
