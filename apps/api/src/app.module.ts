import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HealthController } from "./health/health.controller.js";
import { InstituteModule } from "./institute/institute.module.js";
import { MailModule } from "./mail/mail.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { TenantMiddleware } from "./tenancy/tenant.middleware.js";

@Module({
  imports: [
    // Per-IP: 120 requests/minute by default; auth and signup routes set stricter limits.
    // TODO(scale): back this with Redis once the API runs on more than one container.
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.DISABLE_RATE_LIMIT === "true",
    }),
    PrismaModule,
    MailModule,
    AuditModule,
    AuthModule,
    PlatformModule,
    InstituteModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes("*");
  }
}
