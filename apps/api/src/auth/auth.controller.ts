import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { AppRequest, AuthContext } from "../common/request.js";
import { AuthService, type IssuedSession } from "./auth.service.js";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "./cookies.js";
import { Auth, Public } from "./decorators.js";
import { ForgotPasswordDto, LoginDto, OtpDto, TokenPasswordDto } from "./dto.js";

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sign in. Send it on the institute's subdomain (or with X-Institute-Slug); without one it's a platform-admin sign-in. */
  @Public()
  @Throttle(STRICT)
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto, req.tenantSlug, client(req)));
  }

  @Public()
  @Throttle(STRICT)
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], client(req)));
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
  }

  @Get("me")
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth.userId, auth.instituteId).then((r) => ({ ...r, roles: auth.roles, isPlatformAdmin: auth.isPlatformAdmin }));
  }

  @Public()
  @Throttle(STRICT)
  @Post("invite/accept")
  @HttpCode(204)
  acceptInvite(@Body() dto: TokenPasswordDto) {
    return this.auth.acceptInvite(dto.token, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password/forgot")
  @HttpCode(204)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: AppRequest) {
    return this.auth.forgotPassword(dto.email, req.tenantSlug);
  }

  @Public()
  @Throttle(STRICT)
  @Post("password/reset")
  @HttpCode(204)
  resetPassword(@Body() dto: TokenPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post("mfa/setup")
  @HttpCode(200)
  setupMfa(@Auth() auth: AuthContext) {
    return this.auth.setupMfa(auth.userId);
  }

  @Throttle(STRICT)
  @Post("mfa/enable")
  @HttpCode(204)
  enableMfa(@Auth() auth: AuthContext, @Body() dto: OtpDto) {
    return this.auth.enableMfa(auth.userId, dto.code);
  }

  @Throttle(STRICT)
  @Post("mfa/disable")
  @HttpCode(204)
  disableMfa(@Auth() auth: AuthContext, @Body() dto: OtpDto) {
    return this.auth.disableMfa(auth.userId, dto.code);
  }

  /** The refresh token only ever travels in its httpOnly cookie, never in a response body. */
  private respond(res: Response, session: IssuedSession) {
    setAuthCookies(res, session.accessToken, session.refreshToken);
    const { refreshToken: _omit, ...body } = session;
    return body;
  }
}

function client(req: AppRequest) {
  return { ip: req.ip, userAgent: req.header("user-agent")?.slice(0, 300) };
}
