import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type Prisma, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { actorMembership } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import { toDate } from "../people/people.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateAccountDto, JournalsQuery, ManualJournalDto, UpdateAccountDto } from "./dto.js";
import { LedgerService } from "./ledger.service.js";
import { D } from "./money.js";

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  list(iid: string) {
    return this.prisma.tenant(iid, (tx) =>
      tx.account.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true, parentId: true, isSystem: true, isActive: true } }),
    );
  }

  create(iid: string, dto: CreateAccountDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (await tx.account.findFirst({ where: { code: dto.code } })) throw new ConflictException(`Account code ${dto.code} is already used`);
      if (dto.parentId) {
        const parent = await tx.account.findUnique({ where: { id: dto.parentId } });
        if (!parent) throw new NotFoundException("Parent account not found");
        if (parent.type !== dto.type) throw new BadRequestException("A sub-account must have the same type as its parent");
      }
      const a = await tx.account.create({ data: { instituteId: iid, ...dto } });
      await this.audit.record({ action: "account.create", entityType: "Account", entityId: a.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return a;
    });
  }

  /** System accounts can be renamed but never deactivated: the automatic postings use them. */
  update(iid: string, id: string, dto: UpdateAccountDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const a = await tx.account.findUnique({ where: { id } });
      if (!a) throw new NotFoundException();
      if (a.isSystem && dto.isActive === false) throw new BadRequestException("System accounts can't be deactivated");
      const updated = await tx.account.update({ where: { id }, data: dto });
      await this.audit.record({ action: "account.update", entityType: "Account", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return updated;
    });
  }

  /** For adjustments the automatic postings don't cover: salaries paid, owner's capital, depreciation… */
  postManual(iid: string, dto: ManualJournalDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const entry = await this.ledger.post(tx, iid, {
        date: toDate(dto.date)!,
        memo: dto.memo,
        sourceType: "Manual",
        postedById: by.id,
        lines: dto.lines.map((l) => ({ accountId: l.accountId, debit: D(l.debit ?? 0), credit: D(l.credit ?? 0) })),
      });
      await this.audit.record({ action: "journal.manual", entityType: "JournalEntry", entityId: entry.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return tx.journalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: { include: { account: { select: { code: true, name: true } } } } } });
    });
  }

  /** Only manual entries are reversed by hand; documents are reversed by voiding them. */
  reverseManual(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException();
      if (entry.sourceType !== "Manual" || entry.reversalOfId) throw new BadRequestException("Only manual journal entries can be reversed here; void the invoice, bill or payment instead");
      const by = await actorMembership(tx, auth, [Role.ACCOUNTANT, Role.INSTITUTE_ADMIN]);
      const rev = await this.ledger.reverse(tx, iid, id, { date: new Date(), memo: `Reversal: ${entry.memo ?? ""}`.trim(), postedById: by.id });
      await this.audit.record({ action: "journal.reverse", entityType: "JournalEntry", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
      return rev;
    });
  }

  /** The day book: entries in a date range, newest first, optionally touching one account. */
  journals(iid: string, q: JournalsQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.JournalEntryWhereInput = {
        date: { gte: toDate(q.from), lte: toDate(q.to) },
        ...(q.accountId && { lines: { some: { accountId: q.accountId } } }),
      };
      const items = await tx.journalEntry.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          lines: { select: { debit: true, credit: true, account: { select: { id: true, code: true, name: true } } } },
          postedBy: { select: { user: { select: { name: true } } } },
        },
      });
      const total = await tx.journalEntry.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }
}
