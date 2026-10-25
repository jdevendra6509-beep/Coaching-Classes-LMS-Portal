import { Injectable } from "@nestjs/common";
import { AccountType, Role } from "@lms/db";
import { InvitesService } from "../auth/invites.service.js";
import { SEQUENCE_DEFAULTS } from "../common/sequence.js";
import type { MailMessage } from "../mail/mail.service.js";
import type { Tx } from "../prisma/prisma.service.js";

/** Accounts every institute starts with; the posting rules for fees and bills depend on the system ones. */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: "1000", name: "Cash in Hand", type: AccountType.ASSET },
  { code: "1010", name: "Bank", type: AccountType.ASSET },
  { code: "1100", name: "Accounts Receivable", type: AccountType.ASSET },
  { code: "2000", name: "Accounts Payable", type: AccountType.LIABILITY },
  { code: "2100", name: "GST Payable", type: AccountType.LIABILITY },
  { code: "3000", name: "Owner's Capital", type: AccountType.EQUITY },
  { code: "4000", name: "Fee Income", type: AccountType.INCOME },
  { code: "4900", name: "Other Income", type: AccountType.INCOME },
  { code: "5000", name: "Salaries", type: AccountType.EXPENSE },
  { code: "5100", name: "Rent", type: AccountType.EXPENSE },
  { code: "5200", name: "Utilities", type: AccountType.EXPENSE },
  { code: "5300", name: "Marketing", type: AccountType.EXPENSE },
  { code: "5900", name: "Other Expenses", type: AccountType.EXPENSE },
];

@Injectable()
export class ProvisioningService {
  constructor(private readonly invites: InvitesService) {}

  /** Seeds institute defaults. Idempotent, so it is safe to run again for an existing institute. */
  async seedInstitute(tx: Tx, instituteId: string): Promise<void> {
    await tx.account.createMany({
      data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, instituteId, isSystem: true })),
      skipDuplicates: true,
    });
    await tx.documentSequence.createMany({
      data: Object.entries(SEQUENCE_DEFAULTS).map(([type, prefix]) => ({ type, prefix, instituteId })),
      skipDuplicates: true,
    });
  }

  /** Welcome emails for the institute's admins, to send after the caller's transaction commits. */
  async welcomeAdmins(tx: Tx, instituteId: string): Promise<MailMessage[]> {
    const institute = await tx.institute.findUniqueOrThrow({ where: { id: instituteId } });
    const admins = await tx.membership.findMany({
      where: { instituteId, role: Role.INSTITUTE_ADMIN, isActive: true },
      include: { user: true },
    });
    const messages: MailMessage[] = [];
    for (const { user } of admins) messages.push(await this.invites.welcomeMessage(tx, institute, user)); // sequential: one connection
    return messages;
  }

  sendAll(messages: MailMessage[]): Promise<void> {
    return this.invites.sendAll(messages);
  }
}
