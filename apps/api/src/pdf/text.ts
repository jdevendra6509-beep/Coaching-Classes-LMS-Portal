import { PDFFont, rgb, type RGB } from "pdf-lib";

export const FONTS = {
  Helvetica: "Helvetica",
  "Helvetica-Bold": "Helvetica-Bold",
  "Helvetica-Oblique": "Helvetica-Oblique",
  "Times-Roman": "Times-Roman",
  "Times-Bold": "Times-Bold",
  "Times-Italic": "Times-Italic",
  Courier: "Courier",
  "Courier-Bold": "Courier-Bold",
} as const;
export type FontName = keyof typeof FONTS;

/**
 * The 14 standard PDF fonts only cover Western European characters. Accents are folded
 * (é → e) and anything else the font can't draw is dropped rather than failing the document.
 * TODO: let institutes upload a Unicode font (e.g. Noto Sans Devanagari) for names in Indian scripts.
 */
export function drawable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.normalize("NFKD").replace(/[̀-ͯ]/g, "")]
    .filter((ch) => ch === " " || supported.has(ch.codePointAt(0)!))
    .join("");
}

export function hexColor(hex: string): RGB {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "000000";
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DATE_FORMATS = ["D MMMM YYYY", "D MMM YYYY", "DD/MM/YYYY", "DD-MM-YYYY", "MMMM D, YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export function formatDate(d: Date, format: DateFormat = "D MMMM YYYY"): string {
  const day = d.getUTCDate();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  const dd = String(day).padStart(2, "0");
  const mm = String(m + 1).padStart(2, "0");
  switch (format) {
    case "D MMM YYYY": return `${day} ${MONTHS[m].slice(0, 3)} ${y}`;
    case "DD/MM/YYYY": return `${dd}/${mm}/${y}`;
    case "DD-MM-YYYY": return `${dd}-${mm}-${y}`;
    case "MMMM D, YYYY": return `${MONTHS[m]} ${day}, ${y}`;
    case "YYYY-MM-DD": return `${y}-${mm}-${dd}`;
    default: return `${day} ${MONTHS[m]} ${y}`;
  }
}

/** Indian digit grouping: 125000.5 → "1,25,000.50". */
export function inr(value: string | number): string {
  const [whole, frac = "00"] = Number(value).toFixed(2).split(".");
  const neg = whole.startsWith("-");
  const digits = neg ? whole.slice(1) : whole;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${rest ? `${rest},` : ""}${last3}.${frac}`;
}
