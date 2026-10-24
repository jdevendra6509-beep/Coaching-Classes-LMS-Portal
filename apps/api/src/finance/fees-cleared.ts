import { InvoiceStatus } from "@lms/db";
import type { Tx } from "../prisma/prisma.service.js";
import { D } from "./money.js";

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
