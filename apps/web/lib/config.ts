export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const PLATFORM_HOST = process.env.PLATFORM_HOST ?? "localhost";

const RESERVED = new Set(["www", "api", "app", "admin", "platform", "mail", "static", "assets", "cdn", "help", "support", "status", "docs"]);

/** "alpha.lvh.me:3000" → "alpha"; the bare platform host (or anything else) → null. */
export function slugFromHost(host: string | null): string | null {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const suffix = `.${PLATFORM_HOST}`;
  if (!hostname.endsWith(suffix)) return null;
  const sub = hostname.slice(0, -suffix.length);
  return sub && !sub.includes(".") && !RESERVED.has(sub) ? sub : null;
}
