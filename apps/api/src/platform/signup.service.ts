import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { Role } from "@lms/db";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RESERVED_SLUGS } from "../tenancy/tenant.middleware.js";
import type { SignupDto } from "./dto.js";
import { SLUG_PATTERN } from "./dto.js";
import { chargeAmountPaise } from "./money.js";
import { RazorpayService } from "./razorpay.service.js";

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  listPublicPlans() {
    return this.db.plan
      .findMany({
        where: { isActive: true, razorpayPlanId: { not: null } },
        select: { code: true, name: true, pricePerMonth: true, maxStudents: true, maxStorageMb: true },
        orderBy: { pricePerMonth: "asc" },
      })
      .then((plans) => plans.map((p) => ({ ...p, gstRate: env().PLATFORM_GST_RATE })));
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) return false;
    return (await this.db.institute.count({ where: { slug } })) === 0;
  }

  /**
   * Step 1 of onboarding. Creates the institute (PENDING_PAYMENT), its owner as an invited
   * admin, and a Razorpay subscription. Nothing is activated here: the institute goes live
   * only when Razorpay's webhook confirms the first charge.
   */
  async signup(dto: SignupDto) {
    if (RESERVED_SLUGS.has(dto.slug)) throw new BadRequestException("This subdomain is reserved");
    const plan = await this.db.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan?.isActive || !plan.razorpayPlanId) throw new BadRequestException("Unknown plan");

    const { institute, subscription } = await this.db
      .$transaction(async (tx) => {
        const institute = await tx.institute.create({
          data: {
            slug: dto.slug,
            name: dto.instituteName,
            email: dto.email,
            phone: dto.phone,
            city: dto.city,
            state: dto.state,
          },
        });
        // An existing account (e.g. someone already teaching elsewhere) is reused, never overwritten.
        const owner = await tx.user.upsert({
          where: { email: dto.email },
          create: { email: dto.email, name: dto.ownerName, phone: dto.phone },
          update: {},
        });
        await tx.membership.create({ data: { instituteId: institute.id, userId: owner.id, role: Role.INSTITUTE_ADMIN } });
        const subscription = await tx.subscription.create({ data: { instituteId: institute.id, planId: plan.id } });
        return { institute, subscription };
      })
      .catch((err) => {
        if (err?.code === "P2002") throw new ConflictException("This subdomain is already taken");
        throw err;
      });

    let rzp: { id: string; shortUrl: string };
    try {
      rzp = await this.razorpay.createSubscription({
        planId: plan.razorpayPlanId,
        notes: { instituteId: institute.id, subscriptionId: subscription.id },
      });
    } catch (err) {
      this.logger.error(`Razorpay subscription create failed: ${(err as Error).message}`);
      await this.db.institute.delete({ where: { id: institute.id } }); // frees the slug; cascades to the rest
      throw new BadGatewayException("Payment provider unavailable, please try again");
    }
    await this.db.subscription.update({ where: { id: subscription.id }, data: { razorpaySubscriptionId: rzp.id } });

    return {
      instituteId: institute.id,
      slug: institute.slug,
      razorpayKeyId: this.razorpay.keyId,
      razorpaySubscriptionId: rzp.id,
      paymentUrl: rzp.shortUrl,
      amountPaise: chargeAmountPaise(plan.pricePerMonth, env().PLATFORM_GST_RATE),
    };
  }
}
