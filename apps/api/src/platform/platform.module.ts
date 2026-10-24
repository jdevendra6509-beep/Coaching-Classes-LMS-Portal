import { Module } from "@nestjs/common";
import { PlatformAdminController, PublicSignupController, WebhooksController } from "./platform.controller.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import { ProvisioningService } from "./provisioning.service.js";
import { RazorpayService } from "./razorpay.service.js";
import { SignupService } from "./signup.service.js";
import { WebhooksService } from "./webhooks.service.js";

@Module({
  controllers: [PublicSignupController, WebhooksController, PlatformAdminController],
  providers: [RazorpayService, ProvisioningService, SignupService, WebhooksService, PlatformAdminService],
  exports: [ProvisioningService],
})
export class PlatformModule {}
