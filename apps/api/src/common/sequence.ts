import type { Tx } from "../prisma/prisma.service.js";

export const SEQUENCE_DEFAULTS = {
  ADMISSION: "ADM-",
  INVOICE: "INV-",
  RECEIPT: "RCT-",
  CERTIFICATE: "CERT-",
} as const;

export type SequenceType = keyof typeof SEQUENCE_DEFAULTS;

/**
 * Next gap-free document number for the institute, e.g. "ADM-00042". The row lock taken by the
 * upsert serialises concurrent callers, and rolls back with the caller's transaction, so a failed
 * operation never burns a number.
 */
export async function nextDocumentNumber(tx: Tx, instituteId: string, type: SequenceType): Promise<string> {
  const [row] = await tx.$queryRaw<{ prefix: string; issued: number }[]>`
    INSERT INTO "DocumentSequence" ("instituteId", type, prefix, "nextNumber")
    VALUES (${instituteId}::uuid, ${type}, ${SEQUENCE_DEFAULTS[type]}, 2)
    ON CONFLICT ("instituteId", type) DO UPDATE SET "nextNumber" = "DocumentSequence"."nextNumber" + 1
    RETURNING prefix, "nextNumber" - 1 AS issued`;
  return `${row.prefix}${String(row.issued).padStart(5, "0")}`;
}
