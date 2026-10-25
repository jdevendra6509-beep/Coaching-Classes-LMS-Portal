import type { CookieOptions, Response } from "express";
import { env, isProd } from "../config/env.js";

export const ACCESS_COOKIE = "lms_at";
export const REFRESH_COOKIE = "lms_rt";

// Host-only cookies (no Domain attribute): a session on alpha.<host> is never sent to beta.<host>.
const base = (): CookieOptions => ({ httpOnly: true, secure: isProd(), sameSite: "lax" });

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), path: "/", maxAge: env().ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    path: "/",
    maxAge: env().REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: "/" });
}
