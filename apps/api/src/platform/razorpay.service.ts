import { Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import Razorpay from "razorpay";
import { safeEqual } from "../common/crypto.js";
import { env } from "../config/env.js";

/** Subscription periods to authorise up front: 10 years of monthly charges; cancellable any time. */
const TOTAL_MONTHLY_CYCLES = 120;

/** Thin wrapper over the Razorpay SDK so tests can substitute a fake. */
@Injectable()
export class RazorpayService {
  private client?: Razorpay;

  private get api(): Razorpay {
    this.client ??= new Razorpay({ key_id: env().RAZORPAY_KEY_ID, key_secret: env().RAZORPAY_KEY_SECRET });
    return this.client;
  }

  get keyId(): string {
    return env().RAZORPAY_KEY_ID;
  }

  async createPlan(input: { name: string; amountPaise: number; description?: string }): Promise<string> {
    const plan = await this.api.plans.create({
      period: "monthly",
      interval: 1,
      item: { name: input.name, amount: input.amountPaise, currency: "INR", description: input.description },
    });
    return plan.id;
  }

  async createSubscription(input: { planId: string; notes: Record<string, string> }): Promise<{ id: string; shortUrl: string }> {
    const sub = await this.api.subscriptions.create({
      plan_id: input.planId,
      total_count: TOTAL_MONTHLY_CYCLES,
      customer_notify: 1,
      notes: input.notes,
    });
    return { id: sub.id, shortUrl: sub.short_url };
  }

  async cancelSubscription(id: string, atCycleEnd = true): Promise<void> {
    await this.api.subscriptions.cancel(id, atCycleEnd);
  }

  /** Razorpay signs the exact raw request body with the webhook secret (HMAC-SHA256, hex). */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = env().RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }
}
