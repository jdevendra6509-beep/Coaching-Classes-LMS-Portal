import { Prisma } from "@lms/db";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const ZERO = new Decimal(0);

/** Exact decimal from an API number (never via float arithmetic). */
export const D = (v: Prisma.Decimal.Value) => new Decimal(typeof v === "number" ? String(v) : v);

/** Rounds to paise, half-up (as Indian tax invoices do). */
export const round2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const sum = (values: Decimal[]) => values.reduce((a, b) => a.add(b), ZERO);

/**
 * Splits `total` across `weights` in proportion, in paise, so the parts add up to exactly
 * `total` (the rounding remainder goes to the largest part).
 */
export function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  const whole = sum(weights);
  if (whole.isZero()) return weights.map(() => ZERO);
  const parts = weights.map((w) => round2(total.mul(w).div(whole)));
  const diff = total.sub(sum(parts));
  if (!diff.isZero()) {
    const i = weights.reduce((best, w, idx) => (w.gt(weights[best]) ? idx : best), 0);
    parts[i] = parts[i].add(diff);
  }
  return parts;
}

/** Normal-balance side by account type: assets and expenses grow with debits. */
export const debitNormal = (type: string) => type === "ASSET" || type === "EXPENSE";

/** Anything Decimal accepts: Decimal, string or number. */
export type MoneyValue = Prisma.Decimal.Value;
