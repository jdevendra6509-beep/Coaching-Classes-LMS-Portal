import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AcademicsModule } from "./academics/academics.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter.js";
import { HealthController } from "./health/health.controller.js";
import { InstituteModule } from "./institute/institute.module.js";
import { LmsModule } from "./lms/lms.module.js";
import { MailModule } from "./mail/mail.module.js";
import { PeopleModule } from "./people/people.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { StorageModule } from "./storage/storage.module.js";
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
    PeopleModule,
    AcademicsModule,
    PortalModule,
    StorageModule,
    LmsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes("*");
  }
}
