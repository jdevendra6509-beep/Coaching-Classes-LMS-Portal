import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountType, PaymentMethod } from "@lms/db";
import type { Tx } from "../prisma/prisma.service.js";
import { D, type Decimal, round2, sum, ZERO } from "./money.js";

/** Codes of the seeded system accounts the posting rules depend on. */
export const SYS = {
  CASH: "1000",
  BANK: "1010",
  RECEIVABLE: "1100",
  PAYABLE: "2000",
  GST_PAYABLE: "2100",
  FEE_INCOME: "4000",
} as const;

export interface PostingLine {
  accountId: string;
  debit?: Decimal;
  credit?: Decimal;
}

export interface Posting {
  date: Date;
  memo?: string;
  sourceType: "StudentInvoice" | "StudentPayment" | "Bill" | "BillPayment" | "Manual";
  sourceId?: string;
  postedById: string;
  reversalOfId?: string;
  lines: PostingLine[];
}

/**
 * The only way anything is written to the general ledger. Validates that every entry
 * balances before writing; the database re-checks the same rule at commit.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, instituteId: string, p: Posting) {
    const lines = p.lines
      .map((l) => ({ accountId: l.accountId, debit: round2(l.debit ?? ZERO), credit: round2(l.credit ?? ZERO) }))
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());
    if (lines.length < 2) throw new BadRequestException("A journal entry needs at least two lines");
    for (const l of lines) {
      if (l.debit.isNeg() || l.credit.isNeg() || (!l.debit.isZero() && !l.credit.isZero())) {
        throw new BadRequestException("Each line is either a debit or a credit, and positive");
      }
    }
    const dr = sum(lines.map((l) => l.debit));
    const cr = sum(lines.map((l) => l.credit));
    if (!dr.eq(cr)) throw new BadRequestException(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal`);

    const accounts = await tx.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) } }, select: { id: true, isActive: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const l of lines) {
      const a = byId.get(l.accountId);
      if (!a) throw new NotFoundException("Account not found");
      if (!a.isActive) throw new BadRequestException("One of the accounts is inactive");
    }

    return tx.journalEntry.create({
      data: {
        instituteId,
        date: p.date,
        memo: p.memo,
        sourceType: p.sourceType,
        sourceId: p.sourceId,
        reversalOfId: p.reversalOfId,
        postedById: p.postedById,
        lines: { create: lines }, // instituteId comes from the entry via the composite key
      },
    });
  }

  /** Cancels an earlier entry with its mirror image (debits ↔ credits), dated `date`. */
  async reverse(tx: Tx, instituteId: string, entryId: string, opts: { date: Date; memo: string; postedById: string }) {
    const original = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
    if (!original) throw new NotFoundException("Journal entry not found");
    if (await tx.journalEntry.findFirst({ where: { reversalOfId: entryId } })) throw new BadRequestException("Already reversed");
    return this.post(tx, instituteId, {
      date: opts.date,
      memo: opts.memo,
      sourceType: original.sourceType as Posting["sourceType"],
      sourceId: original.sourceId ?? undefined,
      postedById: opts.postedById,
      reversalOfId: entryId,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })),
    });
  }

  /** The entry a business document posted (not counting reversals). */
  sourceEntry(tx: Tx, sourceType: Posting["sourceType"], sourceId: string) {
    return tx.journalEntry.findFirst({ where: { sourceType, sourceId, reversalOfId: null } });
  }

  async systemAccount(tx: Tx, code: string): Promise<string> {
    const a = await tx.account.findFirst({ where: { code, isSystem: true } });
    if (!a) throw new BadRequestException(`System account ${code} is missing; contact support`);
    return a.id;
  }

  /**
   * The cash/bank account money moves through: an explicit asset account if given, otherwise
   * Cash in Hand for cash and Bank for everything else.
   */
  async moneyAccount(tx: Tx, method: PaymentMethod, accountId?: string): Promise<string> {
    if (accountId) {
      const a = await tx.account.findUnique({ where: { id: accountId } });
      if (!a) throw new NotFoundException("Account not found");
      if (a.type !== AccountType.ASSET || !a.isActive) throw new BadRequestException("Money must go into an active asset (cash/bank) account");
      return a.id;
    }
    return this.systemAccount(tx, method === PaymentMethod.CASH ? SYS.CASH : SYS.BANK);
  }
}
