import "server-only";
import { API_URL } from "./config";

/** Server-side read of a public API endpoint (no session). Returns null on any failure. */
export async function publicGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
