export const FIELD_LABELS: Record<string, string> = {
  studentName: "Student name",
  admissionNo: "Admission no.",
  courseName: "Course name",
  courseCode: "Course code",
  batchName: "Batch",
  durationWeeks: "Duration (weeks)",
  completionDate: "Completion date",
  issueDate: "Issue date",
  serialNo: "Serial no.",
  instituteName: "Institute name",
  teacherName: "Teacher name",
  verificationUrl: "Verification link",
  verificationCode: "Verification code",
  verificationQr: "Verification QR code",
};

export const SAMPLE: Record<string, string> = {
  studentName: "Aditi Venkataraman",
  admissionNo: "ADM-00042",
  courseName: "JEE Advanced 2027",
  courseCode: "JEE27",
  batchName: "Morning A",
  durationWeeks: "48",
  completionDate: "24 October 2026",
  issueDate: "24 October 2026",
  serialNo: "CERT-00042",
  instituteName: "Your Institute",
  teacherName: "Prakash Rao",
  verificationUrl: "https://…/verify/ABCD2345EFGH",
  verificationCode: "ABCD2345EFGH",
};

export interface TemplateField {
  key?: string;
  text?: string;
  x: number;
  y: number;
  fontSize?: number;
  font?: string;
  color?: string;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  size?: number;
  dateFormat?: string;
}

/** A sensible starting layout; fits both A4 portrait and landscape. */
export const DEFAULT_FIELDS: TemplateField[] = [
  { key: "studentName", x: 420, y: 270, fontSize: 30, font: "Times-Bold", align: "center", maxWidth: 520, color: "#1e293b" },
  { text: "has successfully completed {courseName}", x: 420, y: 315, fontSize: 15, font: "Helvetica", align: "center", color: "#334155" },
  { text: "on {completionDate}", x: 420, y: 340, fontSize: 13, font: "Helvetica", align: "center", color: "#334155", dateFormat: "D MMMM YYYY" },
  { key: "serialNo", x: 60, y: 560, fontSize: 9, font: "Helvetica", color: "#64748b" },
  { key: "verificationQr", x: 470, y: 440, size: 80 },
];

export const FONTS = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Times-Roman", "Times-Bold", "Times-Italic", "Courier", "Courier-Bold"];
export const DATE_FORMATS = ["D MMMM YYYY", "D MMM YYYY", "DD/MM/YYYY", "DD-MM-YYYY", "MMMM D, YYYY", "YYYY-MM-DD"];

/** CSS stand-ins for the PDF standard fonts, for the on-screen preview only. */
export function cssFont(font = "Helvetica") {
  const family = font.startsWith("Times") ? "Times New Roman, serif" : font.startsWith("Courier") ? "Courier New, monospace" : "Helvetica, Arial, sans-serif";
  return { fontFamily: family, fontWeight: font.includes("Bold") ? 700 : 400, fontStyle: font.includes("Italic") || font.includes("Oblique") ? "italic" : "normal" };
}

export function fieldText(f: TemplateField) {
  if (f.key) return SAMPLE[f.key] ?? f.key;
  return (f.text ?? "").replace(/\{(\w+)\}/g, (w, k: string) => SAMPLE[k] ?? w);
}
