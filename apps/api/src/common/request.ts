import type { Request } from "express";
import type { Role } from "@lms/db";

/** Claims carried in the access token and attached to the request by the auth guard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  isPlatformAdmin: boolean;
  /** Set for institute sessions; null for platform-admin sessions. */
  instituteId: string | null;
  slug: string | null;
  roles: Role[];
}

export interface AppRequest extends Request {
  /** Institute slug the request is addressed to (subdomain or X-Institute-Slug), if any. */
  tenantSlug?: string;
  auth?: AuthContext;
  rawBody?: Buffer;
}
