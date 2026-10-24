import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InstituteStatus, type PaymentStatus, type Prisma } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreatePlanDto, ListInstitutesQuery, ListPaymentsQuery, UpdatePlanDto } from "./dto.js";
import { chargeAmountPaise } from "./money.js";
import { ProvisioningService } from "./provisioning.service.js";
import { RazorpayService } from "./razorpay.service.js";

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  async listInstitutes(q: ListInstitutesQuery) {
    const where: Prisma.InstituteWhereInput = {
      status: q.status,
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: "insensitive" } },
          { slug: { contains: q.search.toLowerCase() } },
          { email: { contains: q.search, mode: "insensitive" } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.db.institute.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: { select: { code: true, name: true } } } },
          _count: { select: { students: true, teachers: true } },
        },
      }),
      this.db.institute.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async getInstitute(id: string) {
    const institute = await this.db.institute.findUnique({
      where: { id },
      include: {
        subscriptions: { orderBy: { createdAt: "desc" }, include: { plan: true } },
        platformPayments: { orderBy: { createdAt: "desc" }, take: 24 },
        memberships: {
          where: { role: "INSTITUTE_ADMIN" },
          select: { user: { select: { id: true, name: true, email: true, status: true } } },
        },
        _count: { select: { students: true, teachers: true, courses: true } },
      },
    });
    if (!institute) throw new NotFoundException();
    return institute;
  }

  /** Blocks the institute immediately: status flips and every live session is revoked. */
  async suspend(id: string, reason: string, actorUserId: string) {
    await this.db.$transaction(async (tx) => {
      const institute = await tx.institute.findUnique({ where: { id } });
      if (!institute) throw new NotFoundException();
      await tx.institute.update({ where: { id }, data: { status: InstituteStatus.SUSPENDED } });
      await tx.authSession.updateMany({ where: { instituteId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        { action: "institute.suspend", entityType: "Institute", entityId: id, instituteId: id, actorUserId, metadata: { reason, from: institute.status } },
        tx,
      );
    });
    return this.getInstitute(id);
  }

  /** Restores access; the status reflects whether the subscription is paid up. */
  async reactivate(id: string, actorUserId: string) {
    await this.db.$transaction(async (tx) => {
      const institute = await tx.institute.findUnique({
        where: { id },
        include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!institute) throw new NotFoundException();
      if (institute.status !== InstituteStatus.SUSPENDED) throw new BadRequestException("Institute is not suspended");
      const paidUntil = institute.subscriptions[0]?.currentPeriodEnd;
      const status = !paidUntil ? InstituteStatus.PENDING_PAYMENT : paidUntil > new Date() ? InstituteStatus.ACTIVE : InstituteStatus.PAST_DUE;
      await tx.institute.update({ where: { id }, data: { status } });
      await this.audit.record({ action: "institute.reactivate", entityType: "Institute", entityId: id, instituteId: id, actorUserId, metadata: { to: status } }, tx);
    });
    return this.getInstitute(id);
  }

  async resendWelcome(id: string, actorUserId: string) {
    const institute = await this.db.institute.findUnique({ where: { id } });
    if (!institute) throw new NotFoundException();
    if (institute.status === InstituteStatus.PENDING_PAYMENT) throw new BadRequestException("Institute has not paid yet");
    const mail = await this.db.$transaction((tx) => this.provisioning.welcomeAdmins(tx, id));
    await this.provisioning.sendAll(mail);
    await this.audit.record({ action: "institute.resend_welcome", entityType: "Institute", entityId: id, instituteId: id, actorUserId });
    return { sent: mail.length };
  }

  async listPayments(q: ListPaymentsQuery) {
    const where: Prisma.PlatformPaymentWhereInput = {
      instituteId: q.instituteId,
      status: q.status as PaymentStatus | undefined,
    };
    const [items, total] = await Promise.all([
      this.db.platformPayment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { institute: { select: { id: true, slug: true, name: true } } },
      }),
      this.db.platformPayment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  listPlans() {
    return this.db.plan.findMany({ orderBy: { pricePerMonth: "asc" }, include: { _count: { select: { subscriptions: true } } } });
  }

  /** Razorpay plans are immutable, so the price is fixed at creation; to change it, create a new plan. */
  async createPlan(dto: CreatePlanDto, actorUserId: string) {
    if (await this.db.plan.findUnique({ where: { code: dto.code } })) throw new ConflictException("Plan code already exists");
    let razorpayPlanId: string;
    try {
      razorpayPlanId = await this.razorpay.createPlan({
        name: dto.name,
        amountPaise: chargeAmountPaise(dto.pricePerMonth, env().PLATFORM_GST_RATE),
        description: `${dto.name} - monthly, incl. ${env().PLATFORM_GST_RATE}% GST`,
      });
    } catch {
      throw new BadGatewayException("Could not create the plan in Razorpay");
    }
    const plan = await this.db.plan.create({ data: { ...dto, razorpayPlanId } });
    await this.audit.record({ action: "plan.create", entityType: "Plan", entityId: plan.id, actorUserId });
    return plan;
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorUserId: string) {
    const plan = await this.db.plan.update({ where: { id }, data: dto }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException();
      throw err;
    });
    await this.audit.record({ action: "plan.update", entityType: "Plan", entityId: id, actorUserId, metadata: { ...dto } });
    return plan;
  }
}
