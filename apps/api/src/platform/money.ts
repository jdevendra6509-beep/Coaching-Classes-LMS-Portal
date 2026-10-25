import { Prisma } from "@lms/db";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Monthly price (ex-GST, rupees) → amount Razorpay charges, in paise, GST included. */
export function chargeAmountPaise(pricePerMonth: Prisma.Decimal.Value, gstRatePercent: number): number {
  return new Decimal(pricePerMonth)
    .mul(new Decimal(100).add(gstRatePercent))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Splits a GST-inclusive amount in paise into the taxable value and GST, in rupees. */
export function splitGst(totalPaise: number, gstRatePercent: number): { amount: Decimal; gst: Decimal } {
  const total = new Decimal(totalPaise).div(100);
  const base = total.mul(100).div(new Decimal(100).add(gstRatePercent)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { amount: base, gst: total.sub(base) };
}
