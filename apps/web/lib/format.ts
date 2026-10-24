/** Indian grouping: 125000.5 → "₹1,25,000.50". */
export function inr(value: string | number | null | undefined, opts: { symbol?: boolean } = {}): string {
  const n = Number(value ?? 0);
  const s = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}${opts.symbol === false ? "" : "₹"}${s}`;
}

/** "2026-10-24" or an ISO timestamp → "24 Oct 2026". */
export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export const today = () => new Date().toISOString().slice(0, 10);

export function bytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const ACRONYMS: Record<string, string> = { UPI: "UPI" };

/** "BANK_TRANSFER" → "Bank transfer"; known acronyms stay upper-case. */
export const titleCase = (s: string) => ACRONYMS[s] ?? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
