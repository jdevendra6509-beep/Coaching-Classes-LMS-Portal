import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@lms/db";
import type { AppRequest, AuthContext } from "../common/request.js";

export const IS_PUBLIC = "isPublic";
export const ROLES = "roles";
export const PLATFORM_ADMIN = "platformAdmin";

/** Skips authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires an institute session holding at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
/** Requires a platform-admin session. */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);

export const Auth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => ctx.switchToHttp().getRequest<AppRequest>().auth!,
);

/** The institute id of the current institute session. Use only on @Roles routes. */
export const InstituteId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<AppRequest>().auth?.instituteId;
  if (!id) throw new Error("InstituteId used on a route without an institute session");
  return id;
});
