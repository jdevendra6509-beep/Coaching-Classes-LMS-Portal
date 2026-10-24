import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { InvitesService } from "./invites.service.js";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env().JWT_SECRET,
        signOptions: { expiresIn: env().ACCESS_TOKEN_TTL_SECONDS, algorithm: "HS256" },
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, InvitesService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, InvitesService, JwtModule],
})
export class AuthModule {}
