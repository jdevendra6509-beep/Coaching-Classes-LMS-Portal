/** Error carrying the API's status and message (and code, e.g. MFA_REQUIRED, PLAN_LIMIT). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit an expired access token. */
function refresh(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const raw = (body as { message?: unknown }).message;
  const message = Array.isArray(raw) ? raw.join(". ") : typeof raw === "string" ? raw : res.statusText || "Something went wrong";
  return new ApiError(res.status, message, (body as { code?: string }).code, body);
}

/**
 * Calls the API through this app's /api pass-through. An expired session is refreshed once
 * transparently; if that fails the caller gets the 401 (and the app shell sends them to login).
 */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const req = (): Promise<Response> =>
    fetch(`/api${path}`, {
      ...rest,
      headers: { ...(json !== undefined && { "Content-Type": "application/json" }), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  let res = await req();
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refresh()) res = await req();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (res.headers.get("content-type") ?? "").includes("json") ? res.json() : (res.blob() as Promise<T>);
}

/** Builds "?a=1&b=2" from defined values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Uploads straight to storage with a presigned URL from the API, then returns the upload ticket. */
export async function uploadDirect(ask: { uploadUrl: string; headers: Record<string, string>; uploadToken: string }, file: File): Promise<string> {
  const res = await fetch(ask.uploadUrl, { method: "PUT", headers: ask.headers, body: file });
  if (!res.ok) throw new ApiError(res.status, "The upload to storage failed. Please try again.");
  return ask.uploadToken;
}

/** Opens a PDF the API renders (e.g. a receipt) in a new tab. */
export async function openPdf(path: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
