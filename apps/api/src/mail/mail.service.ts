import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * Sends transactional email over SMTP (Mailpit locally, SES SMTP in production).
 * TODO(worker): move sending onto a BullMQ queue so a slow SMTP server never blocks a request.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  async send(message: MailMessage): Promise<void> {
    this.transporter ??= nodemailer.createTransport(env().SMTP_URL);
    try {
      await this.transporter.sendMail({ from: env().MAIL_FROM, ...message });
    } catch (err) {
      // Never log the body: it can contain one-time links.
      this.logger.error(`Failed to send "${message.subject}": ${(err as Error).message}`);
      throw err;
    }
  }
}
