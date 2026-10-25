import { type NextRequest } from "next/server";
import { API_URL, slugFromHost } from "@/lib/config";

/**
 * Same-origin pass-through to the NestJS API. The browser only ever talks to its own host, so
 * the API's httpOnly session cookies stay scoped to that institute's subdomain. The institute is
 * taken from the Host header here, never from anything the browser sends.
 */
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = new URL(`${API_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`);

  const headers = new Headers();
  for (const name of ["content-type", "accept", "cookie", "authorization", "user-agent", "x-razorpay-signature", "x-razorpay-event-id"]) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  const slug = slugFromHost(request.headers.get("host"));
  if (slug) headers.set("x-institute-slug", slug);
  // The load balancer appends the address it saw to X-Forwarded-For, so the last entry is the
  // real client; earlier entries come from the client and can be forged. The API rate-limits on it.
  const ip = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (ip) headers.set("x-forwarded-for", ip);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const out = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control", "retry-after"]) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
