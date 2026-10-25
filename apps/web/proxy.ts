import { NextResponse, type NextRequest } from "next/server";
import { slugFromHost } from "./lib/config";

/** Pages that work without a session, per site. */
const PUBLIC_INSTITUTE = ["/login", "/accept-invite", "/reset-password", "/forgot-password"];
const PLATFORM_PROTECTED = ["/admin"];

/**
 * One app, two kinds of site. `alpha.<host>/students` renders app/i/[slug]/students for
 * institute "alpha"; the bare host renders app/p (marketing, signup, platform console).
 * The prefix is added here, so a visitor can never address another institute's pages.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const slug = slugFromHost(request.headers.get("host"));
  const hasSession = request.cookies.has("lms_at") || request.cookies.has("lms_rt");

  if (slug) {
    // Optimistic check only: the API enforces every permission on every call.
    if (!hasSession && !PUBLIC_INSTITUTE.some((p) => pathname.startsWith(p))) {
      const login = new URL("/login", request.url);
      if (pathname !== "/") login.searchParams.set("next", pathname + search);
      return NextResponse.redirect(login);
    }
    return NextResponse.rewrite(new URL(`/i/${slug}${pathname}${search}`, request.url));
  }
  if (!hasSession && PLATFORM_PROTECTED.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.rewrite(new URL(`/p${pathname}${search}`, request.url));
}

export const config = {
  // Everything except the API pass-through, Next internals and static files.
  matcher: ["/((?!api/|_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|js|mjs)$).*)"],
};
