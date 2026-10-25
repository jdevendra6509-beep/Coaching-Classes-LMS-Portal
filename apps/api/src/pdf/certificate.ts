import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { type DateFormat, drawable, type FontName, FONTS, formatDate, hexColor } from "./text.js";

/** Values a template can print. Dates are formatted per field. */
export const FIELD_KEYS = [
  "studentName",
  "admissionNo",
  "courseName",
  "courseCode",
  "batchName",
  "durationWeeks",
  "completionDate",
  "issueDate",
  "serialNo",
  "instituteName",
  "teacherName",
  "verificationUrl",
  "verificationCode",
  "verificationQr",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
const DATE_KEYS: FieldKey[] = ["completionDate", "issueDate"];

export interface TemplateField {
  /** A value from FIELD_KEYS… */
  key?: FieldKey;
  /** …or fixed text, which may contain {placeholders}, e.g. "has completed {courseName} on {completionDate}". */
  text?: string;
  /** Points from the page's top-left corner. For text, y is the baseline; for the QR code, its top-left. */
  x: number;
  y: number;
  fontSize?: number;
  font?: FontName;
  color?: string;
  align?: "left" | "center" | "right";
  /** Text shrinks to fit this width (long names). */
  maxWidth?: number;
  /** QR code side length in points. */
  size?: number;
  dateFormat?: DateFormat;
}

export interface CertificateValues {
  studentName: string;
  admissionNo: string;
  courseName: string;
  courseCode: string;
  batchName: string;
  durationWeeks: string;
  completionDate: string; // ISO date
  issueDate: string; // ISO date
  serialNo: string;
  instituteName: string;
  teacherName: string;
  verificationUrl: string;
  verificationCode: string;
}

export interface Background {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

function valueOf(key: FieldKey, values: CertificateValues, format?: DateFormat): string {
  if (key === "verificationQr") return values.verificationUrl;
  const raw = values[key as keyof CertificateValues] ?? "";
  return DATE_KEYS.includes(key) && raw ? formatDate(new Date(`${raw.slice(0, 10)}T00:00:00Z`), format) : raw;
}

/** Fills "{placeholder}" text from the values; unknown placeholders are left as typed. */
export function fillText(text: string, values: CertificateValues, format?: DateFormat): string {
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => ((FIELD_KEYS as readonly string[]).includes(k) ? valueOf(k as FieldKey, values, format) : whole));
}

/** Reads a background upload and returns its page size; throws if it isn't a usable PDF/PNG/JPEG. */
export async function inspectBackground(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  if (mime === "application/pdf") {
    const src = await PDFDocument.load(bytes);
    if (!src.getPageCount()) throw new Error("The PDF has no pages");
    return src.getPage(0).getSize();
  }
  const doc = await PDFDocument.create();
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  // Images become an A4-wide page (842 pt, landscape) keeping their aspect ratio.
  return { width: 842, height: Math.round((842 * img.height) / img.width) };
}

/** Draws the fields onto the template background and returns the finished PDF. */
export async function renderCertificate(bg: Background, fields: TemplateField[], values: CertificateValues): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate ${values.serialNo}`);
  doc.setAuthor(values.instituteName);
  doc.setSubject(`${values.courseName}: ${values.studentName}`);
  doc.setCreationDate(new Date(`${values.issueDate.slice(0, 10)}T00:00:00Z`));

  let page;
  if (bg.mime === "application/pdf") {
    // Copying (rather than embedding) keeps the design's own vector content and works for any page.
    const [copied] = await doc.copyPages(await PDFDocument.load(bg.bytes), [0]);
    page = doc.addPage(copied);
  } else {
    const img = bg.mime === "image/png" ? await doc.embedPng(bg.bytes) : await doc.embedJpg(bg.bytes);
    page = doc.addPage([bg.width, bg.height]);
    page.drawImage(img, { x: 0, y: 0, width: bg.width, height: bg.height });
  }
  const { height } = page.getSize();

  for (const f of fields) {
    if (f.key === "verificationQr") {
      const size = f.size ?? 80;
      const png = await QRCode.toBuffer(values.verificationUrl, { margin: 1, width: Math.ceil(size * 4), errorCorrectionLevel: "M" });
      page.drawImage(await doc.embedPng(png), { x: f.x, y: height - f.y - size, width: size, height: size });
      continue;
    }
    const font = await doc.embedFont(StandardFonts[fontEnum(f.font ?? "Helvetica")]);
    const text = drawable(font, f.key ? valueOf(f.key, values, f.dateFormat) : fillText(f.text ?? "", values, f.dateFormat));
    if (!text.trim()) continue;
    let size = f.fontSize ?? 16;
    while (f.maxWidth && size > 6 && font.widthOfTextAtSize(text, size) > f.maxWidth) size -= 0.5;
    const w = font.widthOfTextAtSize(text, size);
    const x = f.align === "center" ? f.x - w / 2 : f.align === "right" ? f.x - w : f.x;
    page.drawText(text, { x, y: height - f.y, size, font, color: hexColor(f.color ?? "#000000") });
  }
  return doc.save();
}

function fontEnum(name: FontName): keyof typeof StandardFonts {
  const map: Record<FontName, keyof typeof StandardFonts> = {
    Helvetica: "Helvetica",
    "Helvetica-Bold": "HelveticaBold",
    "Helvetica-Oblique": "HelveticaOblique",
    "Times-Roman": "TimesRoman",
    "Times-Bold": "TimesRomanBold",
    "Times-Italic": "TimesRomanItalic",
    Courier: "Courier",
    "Courier-Bold": "CourierBold",
  };
  return map[FONTS[name]];
}
