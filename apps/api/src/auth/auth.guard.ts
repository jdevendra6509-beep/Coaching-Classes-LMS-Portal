import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@lms/db";
import type { AppRequest, AuthContext } from "../common/request.js";
import { IS_PUBLIC, PLATFORM_ADMIN, ROLES } from "./decorators.js";
import { ACCESS_COOKIE } from "./cookies.js";

interface AccessClaims {
  sub: string;
  sid: string;
  pa: boolean;
  iid: string | null;
  slug: string | null;
  roles: Role[];
}

/**
 * Global guard. Every route needs a valid access token unless marked @Public().
 * @Roles routes additionally need an institute session with one of the roles;
 * @PlatformAdmin routes need a platform session. Routes with neither accept any session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException();

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException();
    }

    // A token minted for institute A must not be replayed against institute B's host.
    if (req.tenantSlug && claims.slug !== req.tenantSlug) throw new UnauthorizedException();

    const auth: AuthContext = {
      userId: claims.sub,
      sessionId: claims.sid,
      isPlatformAdmin: claims.pa,
      instituteId: claims.iid,
      slug: claims.slug,
      roles: claims.roles ?? [],
    };
    req.auth = auth;

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (!auth.isPlatformAdmin || auth.instituteId) throw new ForbiddenException();
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length) {
      if (!auth.instituteId || !roles.some((r) => auth.roles.includes(r))) throw new ForbiddenException();
    }
    return true;
  }
}

function extractToken(req: AppRequest): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
}
