import { Injectable, Logger } from "@nestjs/common";
import { AccountType, AuthTokenType, Role, UserStatus } from "@lms/db";
import { AuthService } from "../auth/auth.service.js";
import { instituteUrl } from "../config/env.js";
import type { MailMessage } from "../mail/mail.service.js";
import { MailService } from "../mail/mail.service.js";
import { accessGrantedEmail, inviteEmail } from "../mail/templates.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";

const INVITE_TTL_SECONDS = 7 * 86_400;

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

const DEFAULT_SEQUENCES = [
  { type: "INVOICE", prefix: "INV-" },
  { type: "RECEIPT", prefix: "RCT-" },
  { type: "CERTIFICATE", prefix: "CERT-" },
];

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
  ) {}

  /** Seeds institute defaults. Idempotent, so it is safe to run again for an existing institute. */
  async seedInstitute(tx: Tx, instituteId: string): Promise<void> {
    await tx.account.createMany({
      data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, instituteId, isSystem: true })),
      skipDuplicates: true,
    });
    await tx.documentSequence.createMany({
      data: DEFAULT_SEQUENCES.map((s) => ({ ...s, instituteId })),
      skipDuplicates: true,
    });
  }

  /**
   * Builds the welcome emails for the institute's admins: a set-password link for invited
   * users, a plain "you have access" note for people who already have an account.
   * Returned rather than sent so the caller can send them after its transaction commits.
   */
  async welcomeAdmins(tx: Tx, instituteId: string): Promise<MailMessage[]> {
    const institute = await tx.institute.findUniqueOrThrow({ where: { id: instituteId } });
    const admins = await tx.membership.findMany({
      where: { instituteId, role: Role.INSTITUTE_ADMIN, isActive: true },
      include: { user: true },
    });
    const messages: MailMessage[] = [];
    for (const { user } of admins) {
      if (user.status === UserStatus.INVITED) {
        const token = await this.auth.issueEmailToken(tx, user.id, AuthTokenType.INVITE, INVITE_TTL_SECONDS);
        const link = instituteUrl(institute.slug, `/accept-invite?token=${token}`);
        messages.push(inviteEmail(user.email, user.name, institute.name, link));
      } else {
        messages.push(accessGrantedEmail(user.email, user.name, institute.name, instituteUrl(institute.slug, "/login")));
      }
    }
    return messages;
  }

  /** Best effort: a failed email is logged and can be re-sent from the platform console. */
  async sendAll(messages: MailMessage[]): Promise<void> {
    for (const m of messages) {
      await this.mail.send(m).catch(() => this.logger.warn(`Welcome email to institute admin not sent`));
    }
  }
}
