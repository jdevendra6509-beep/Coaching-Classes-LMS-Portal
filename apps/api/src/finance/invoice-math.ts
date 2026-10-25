import { BadRequestException } from "@nestjs/common";
import { allocate, D, type Decimal, type MoneyValue, round2, sum, ZERO } from "./money.js";

export interface LineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface Totals {
  lines: { description: string; quantity: number; unitPrice: Decimal; taxRate: Decimal; amount: Decimal }[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  /** subtotal − discounts: what is credited to fee income. */
  taxable: Decimal;
  total: Decimal;
}

/**
 * Discounts reduce the taxable value (as GST requires), so they are spread across the lines in
 * proportion to each line's amount before tax is worked out line by line.
 */
export function computeTotals(lines: LineInput[], discountAmounts: Decimal[]): Totals {
  const rows = lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: D(l.unitPrice),
    taxRate: D(l.taxRate),
    amount: round2(D(l.unitPrice).mul(l.quantity)),
  }));
  const subtotal = sum(rows.map((r) => r.amount));
  const discountTotal = round2(sum(discountAmounts));
  if (discountTotal.gt(subtotal)) throw new BadRequestException("Discounts can't exceed the invoice amount");
  const shares = allocate(discountTotal, rows.map((r) => r.amount));
  const taxTotal = sum(rows.map((r, i) => round2(r.amount.sub(shares[i]).mul(r.taxRate).div(100))));
  const taxable = subtotal.sub(discountTotal);
  return { lines: rows, subtotal, discountTotal, taxTotal, taxable, total: taxable.add(taxTotal) };
}

/** Validates an instalment plan: ascending dates, amounts adding up to the total exactly. */
export function checkInstallments(total: Decimal, plan: { dueDate: Date; amount: Decimal }[]) {
  if (!plan.length) return;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].dueDate <= plan[i - 1].dueDate) throw new BadRequestException("Instalment due dates must be in order, one per date");
  }
  const planned = sum(plan.map((p) => p.amount));
  if (!planned.eq(total)) {
    throw new BadRequestException(`Instalments add up to ${planned.toFixed(2)} but the invoice total is ${total.toFixed(2)}`);
  }
}

/**
 * How much of an invoice has fallen due by `on` and isn't paid. Without a schedule the whole
 * invoice falls due on its due date (or its issue date when there is none).
 */
export function overdueAmount(
  inv: { total: MoneyValue; amountPaid: MoneyValue; dueDate: Date | null; issueDate: Date; installments: { dueDate: Date; amount: MoneyValue }[] },
  on: Date,
): Decimal {
  const due = inv.installments.length
    ? sum(inv.installments.filter((i) => i.dueDate < on).map((i) => D(i.amount)))
    : (inv.dueDate ?? inv.issueDate) < on
      ? D(inv.total)
      : ZERO;
  const over = due.sub(D(inv.amountPaid));
  return over.isNeg() ? ZERO : over;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}

/** Integer in Indian numbering words (lakh, crore); crores may themselves exceed 99. */
function integerWords(n: number): string {
  if (n >= 10_000_000) return [`${integerWords(Math.floor(n / 10_000_000))} Crore`, integerWords(n % 10_000_000)].filter(Boolean).join(" ");
  const parts: string[] = [];
  if (n >= 100_000) parts.push(`${below1000(Math.floor(n / 100_000))} Lakh`);
  if (n % 100_000 >= 1000) parts.push(`${below1000(Math.floor((n % 100_000) / 1000))} Thousand`);
  if (n % 1000) parts.push(below1000(n % 1000));
  return parts.join(" ");
}

/** For receipts: 125000.50 → "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only". */
export function rupeesInWords(amount: MoneyValue): string {
  const v = round2(D(amount));
  const rupees = v.floor().toNumber();
  const paise = v.sub(v.floor()).mul(100).toNumber();
  return `Rupees ${integerWords(rupees) || "Zero"}${paise ? ` and ${below1000(paise)} Paise` : ""} Only`;
}
