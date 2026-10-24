import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { AppRequest, AuthContext } from "../common/request.js";
import { Auth, PlatformAdmin, Public } from "../auth/decorators.js";
import { CreatePlanDto, ListInstitutesQuery, ListPaymentsQuery, SignupDto, SlugQuery, SuspendDto, UpdatePlanDto } from "./dto.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import { SignupService } from "./signup.service.js";
import { WebhooksService } from "./webhooks.service.js";

@Public()
@Controller()
export class PublicSignupController {
  constructor(private readonly signup: SignupService) {}

  @Get("plans")
  plans() {
    return this.signup.listPublicPlans();
  }

  @Get("signup/slug-available")
  async slugAvailable(@Query() q: SlugQuery) {
    return { slug: q.slug, available: await this.signup.isSlugAvailable(q.slug) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("signup")
  create(@Body() dto: SignupDto) {
    return this.signup.signup(dto);
  }
}

@Public()
@SkipThrottle()
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("razorpay")
  @HttpCode(200)
  async razorpay(
    @Req() req: AppRequest,
    @Headers("x-razorpay-signature") signature?: string,
    @Headers("x-razorpay-event-id") eventId?: string,
  ) {
    return { status: await this.webhooks.handleRazorpay(req.rawBody, signature, eventId) };
  }
}

@PlatformAdmin()
@Controller("platform")
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get("institutes")
  institutes(@Query() q: ListInstitutesQuery) {
    return this.admin.listInstitutes(q);
  }

  @Get("institutes/:id")
  institute(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.getInstitute(id);
  }

  @Post("institutes/:id/suspend")
  @HttpCode(200)
  suspend(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SuspendDto, @Auth() auth: AuthContext) {
    return this.admin.suspend(id, dto.reason, auth.userId);
  }

  @Post("institutes/:id/reactivate")
  @HttpCode(200)
  reactivate(@Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.admin.reactivate(id, auth.userId);
  }

  @Post("institutes/:id/resend-welcome")
  @HttpCode(200)
  resendWelcome(@Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.admin.resendWelcome(id, auth.userId);
  }

  @Get("payments")
  payments(@Query() q: ListPaymentsQuery) {
    return this.admin.listPayments(q);
  }

  @Get("plans")
  plans() {
    return this.admin.listPlans();
  }

  @Post("plans")
  createPlan(@Body() dto: CreatePlanDto, @Auth() auth: AuthContext) {
    return this.admin.createPlan(dto, auth.userId);
  }

  @Patch("plans/:id")
  updatePlan(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @Auth() auth: AuthContext) {
    return this.admin.updatePlan(id, dto, auth.userId);
  }
}
