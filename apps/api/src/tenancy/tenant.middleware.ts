import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { AppRequest } from "../common/request.js";
import { env } from "../config/env.js";

export const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "platform", "mail", "static", "assets", "cdn", "help", "support", "status", "docs",
]);

/**
 * Works out which institute a request is addressed to. The browser talks to
 * <slug>.<PLATFORM_HOST>; the web app forwards that as X-Institute-Slug when it proxies to
 * the API. This is only a routing hint: it picks the institute at login, and afterwards the
 * auth guard requires it to match the institute inside the signed token.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: AppRequest, _res: Response, next: NextFunction) {
    req.tenantSlug = resolveSlug(req);
    next();
  }
}

export function resolveSlug(req: AppRequest): string | undefined {
  const header = req.header("x-institute-slug")?.trim().toLowerCase();
  if (header) return header;
  const host = (req.hostname ?? "").toLowerCase();
  const suffix = `.${env().PLATFORM_HOST}`;
  if (!host.endsWith(suffix)) return undefined;
  const sub = host.slice(0, -suffix.length);
  return sub && !sub.includes(".") && !RESERVED_SLUGS.has(sub) ? sub : undefined;
}
