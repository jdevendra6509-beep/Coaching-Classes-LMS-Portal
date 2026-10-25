import { Injectable, Logger } from "@nestjs/common";
import { AuthTokenType, type Institute, type User, UserStatus } from "@lms/db";
import { instituteUrl } from "../config/env.js";
import { MailService, type MailMessage } from "../mail/mail.service.js";
import { accessGrantedEmail, inviteEmail } from "../mail/templates.js";
import type { Tx } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";

const INVITE_TTL_SECONDS = 7 * 86_400;

/** Welcome emails for people added to an institute (owners, staff, teachers, students). */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly mail: MailService,
  ) {}

  /**
   * A set-password link for users who haven't set one yet, a plain "you have access" note for
   * people who already have an account. Built inside the caller's transaction (the token is
   * stored there) and returned, so it is only sent once that transaction commits.
   */
  async welcomeMessage(tx: Tx, institute: Pick<Institute, "slug" | "name">, user: Pick<User, "id" | "email" | "name" | "status">): Promise<MailMessage> {
    if (user.status === UserStatus.INVITED) {
      const token = await this.auth.issueEmailToken(tx, user.id, AuthTokenType.INVITE, INVITE_TTL_SECONDS);
      return inviteEmail(user.email, user.name, institute.name, instituteUrl(institute.slug, `/accept-invite?token=${token}`));
    }
    return accessGrantedEmail(user.email, user.name, institute.name, instituteUrl(institute.slug, "/login"));
  }

  /** Best effort: failures are logged and the email can be re-sent with "resend invite". */
  async sendAll(messages: MailMessage[]): Promise<void> {
    for (const m of messages) {
      await this.mail.send(m).catch(() => this.logger.warn("Welcome email not sent"));
    }
  }
}
