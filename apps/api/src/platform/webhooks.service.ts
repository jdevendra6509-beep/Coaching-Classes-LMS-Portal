import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InstituteStatus, PaymentStatus, SubscriptionStatus } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { sha256 } from "../common/crypto.js";
import { env } from "../config/env.js";
import type { MailMessage } from "../mail/mail.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { splitGst } from "./money.js";
import { ProvisioningService } from "./provisioning.service.js";
import { RazorpayService } from "./razorpay.service.js";

// Only the fields we use from Razorpay's webhook payload.
interface RazorpayEvent {
  event: string;
  payload: {
    subscription?: { entity: { id: string; status: string; current_start?: number | null; current_end?: number | null } };
    payment?: { entity: { id: string; amount: number; status: string; order_id?: string | null } };
  };
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  /**
   * Verifies, records and applies a Razorpay webhook exactly once. A non-2xx response makes
   * Razorpay retry, so we only throw for bad signatures and genuine processing failures.
   */
  async handleRazorpay(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<WebhookOutcome> {
    if (!rawBody || !this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException("Invalid signature");
    }
    const event = JSON.parse(rawBody.toString("utf8")) as RazorpayEvent;
    const eventId = eventIdHeader || sha256(rawBody.toString("utf8"));

    const stored = await this.db.webhookEvent.upsert({
      where: { provider_eventId: { provider: "razorpay", eventId } },
      create: { provider: "razorpay", eventId, eventType: event.event, payload: event as object },
      update: {},
    });
    if (stored.processedAt) return "duplicate";

    let outcome: WebhookOutcome;
    let mail: MailMessage[] = [];
    try {
      ({ outcome, mail } = await this.db.$transaction(async (tx) => {
        // Row lock: two concurrent deliveries of the same event serialise here; the second sees processedAt.
        const [row] = await tx.$queryRaw<{ processedAt: Date | null }[]>`
          SELECT "processedAt" FROM "WebhookEvent" WHERE id = ${stored.id}::uuid FOR UPDATE`;
        if (row.processedAt) return { outcome: "duplicate" as const, mail: [] };
        const result = await this.apply(tx, event);
        await tx.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), error: null } });
        return result;
      }));
    } catch (err) {
      await this.db.webhookEvent.update({ where: { id: stored.id }, data: { error: String((err as Error).message).slice(0, 1000) } });
      throw err;
    }
    await this.provisioning.sendAll(mail);
    return outcome;
  }

  private async apply(tx: Tx, event: RazorpayEvent): Promise<{ outcome: WebhookOutcome; mail: MailMessage[] }> {
    const entity = event.payload.subscription?.entity;
    if (!entity) return { outcome: "ignored", mail: [] };

    const sub = await tx.subscription.findUnique({ where: { razorpaySubscriptionId: entity.id }, include: { institute: true } });
    if (!sub) {
      this.logger.warn(`Webhook ${event.event} for unknown subscription ${entity.id}`);
      return { outcome: "ignored", mail: [] };
    }
    const instituteId = sub.instituteId;
    const period = {
      currentPeriodStart: entity.current_start ? new Date(entity.current_start * 1000) : undefined,
      currentPeriodEnd: entity.current_end ? new Date(entity.current_end * 1000) : undefined,
    };
    let mail: MailMessage[] = [];

    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged":
      case "subscription.resumed": {
        const payment = event.payload.payment?.entity;
        if (payment?.status === "captured") {
          const exists = await tx.platformPayment.findUnique({ where: { razorpayPaymentId: payment.id } });
          if (!exists) {
            const { amount, gst } = splitGst(payment.amount, env().PLATFORM_GST_RATE);
            await tx.platformPayment.create({
              data: {
                instituteId,
                subscriptionId: sub.id,
                amount,
                gstAmount: gst,
                status: PaymentStatus.CAPTURED,
                razorpayPaymentId: payment.id,
                razorpayOrderId: payment.order_id ?? undefined,
                periodStart: period.currentPeriodStart ?? new Date(),
                periodEnd: period.currentPeriodEnd ?? new Date(),
                paidAt: new Date(),
              },
            });
          }
        }
        await tx.subscription.update({ where: { id: sub.id }, data: { status: SubscriptionStatus.ACTIVE, ...period } });

        const firstActivation = sub.institute.status === InstituteStatus.PENDING_PAYMENT;
        // A platform-admin suspension is never lifted by a payment; reactivation is a manual decision.
        if (sub.institute.status !== InstituteStatus.SUSPENDED) {
          await tx.institute.update({ where: { id: instituteId }, data: { status: InstituteStatus.ACTIVE } });
        }
        if (firstActivation) {
          await this.provisioning.seedInstitute(tx, instituteId);
          mail = await this.provisioning.welcomeAdmins(tx, instituteId);
        }
        break;
      }
      case "subscription.pending": // a renewal charge failed; Razorpay is retrying
      case "subscription.halted": // retries exhausted
        await tx.subscription.update({ where: { id: sub.id }, data: { status: SubscriptionStatus.PAST_DUE } });
        if (sub.institute.status === InstituteStatus.ACTIVE) {
          await tx.institute.update({ where: { id: instituteId }, data: { status: InstituteStatus.PAST_DUE } });
        }
        break;
      case "subscription.cancelled":
        // Paid in advance, so access continues until the end of the paid period.
        // TODO(worker): a daily job moves institutes to CANCELLED once currentPeriodEnd has passed.
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.CANCELLED, cancelAtPeriodEnd: true },
        });
        break;
      case "subscription.completed":
        await tx.subscription.update({ where: { id: sub.id }, data: { status: SubscriptionStatus.EXPIRED } });
        break;
      default:
        return { outcome: "ignored", mail: [] };
    }

    await this.audit.record(
      { action: `billing.${event.event}`, entityType: "Subscription", entityId: sub.id, instituteId },
      tx,
    );
    return { outcome: "processed", mail };
  }
}
