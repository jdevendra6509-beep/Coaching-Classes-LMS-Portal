import { degrees, PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { drawable, formatDate, inr } from "./text.js";

const A4: [number, number] = [595, 842];
const MARGIN = 48;
const GREY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.8, 0.8, 0.8);

interface InstituteHeader {
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Tiny top-down layout helper over pdf-lib's bottom-up coordinates. */
class Writer {
  y: number;
  private constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.y = page.getHeight() - MARGIN;
  }

  static async create(title: string) {
    const doc = await PDFDocument.create();
    doc.setTitle(title);
    const page = doc.addPage(A4);
    return new Writer(doc, page, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  }

  text(t: string, opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const font = opts.bold ? this.bold : this.regular;
    const size = opts.size ?? 10;
    const s = drawable(font, t);
    const w = font.widthOfTextAtSize(s, size);
    const right = A4[0] - MARGIN;
    const x = opts.align === "right" ? (opts.x ?? right) - w : opts.align === "center" ? A4[0] / 2 - w / 2 : (opts.x ?? MARGIN);
    this.page.drawText(s, { x, y: this.y, size, font, color: opts.color });
  }

  down(by = 14) {
    this.y -= by;
  }

  rule() {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y }, thickness: 0.7, color: LINE });
    this.down(16);
  }

  header(inst: InstituteHeader, docTitle: string) {
    this.text(inst.name, { size: 16, bold: true });
    this.text(docTitle, { size: 14, bold: true, align: "right" });
    this.down(16);
    const addr = [inst.address, [inst.city, inst.state, inst.pincode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
    for (const l of [inst.legalName && inst.legalName !== inst.name ? inst.legalName : null, addr, [inst.phone, inst.email].filter(Boolean).join("  |  "), inst.gstin ? `GSTIN: ${inst.gstin}` : null]) {
      if (l) {
        this.text(l, { size: 9, color: GREY });
        this.down(12);
      }
    }
    this.down(4);
    this.rule();
  }

  /** Two-column label/value row. */
  pair(label: string, value: string, opts: { bold?: boolean } = {}) {
    this.text(label, { color: GREY });
    this.text(value, { x: MARGIN + 140, bold: opts.bold });
    this.down();
  }

  watermark(t: string) {
    this.page.drawText(t, { x: 150, y: 330, size: 80, font: this.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.25, rotate: degrees(35) });
  }

  save() {
    return this.doc.save();
  }
}

const isoDay = (d: Date | string) => formatDate(new Date(typeof d === "string" ? d : d.toISOString()), "DD/MM/YYYY");

export interface ReceiptPdfData {
  receiptNo: string;
  receivedAt: Date;
  amount: string;
  amountInWords: string;
  method: string;
  reference: string | null;
  reversed: boolean;
  reversalReason: string | null;
  institute: InstituteHeader;
  student: { name: string; admissionNo: string };
  invoice: { number: string; total: string; balance: string };
}

export async function receiptPdf(r: ReceiptPdfData): Promise<Uint8Array> {
  const w = await Writer.create(`Receipt ${r.receiptNo}`);
  w.header(r.institute, "FEE RECEIPT");
  w.pair("Receipt no.", r.receiptNo, { bold: true });
  w.pair("Date", isoDay(r.receivedAt));
  w.pair("Received from", `${r.student.name} (${r.student.admissionNo})`);
  w.pair("Against invoice", r.invoice.number);
  w.pair("Payment mode", r.method.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + (r.reference ? `  (Ref: ${r.reference})` : ""));
  w.down(6);
  w.rule();
  w.text("Amount received", { size: 12, bold: true });
  w.text(`Rs. ${inr(r.amount)}`, { size: 12, bold: true, align: "right" });
  w.down(16);
  w.text(r.amountInWords, { size: 9, color: GREY });
  w.down(22);
  w.pair("Invoice total", `Rs. ${inr(r.invoice.total)}`);
  w.pair("Balance due", `Rs. ${inr(r.invoice.balance)}`);
  w.down(30);
  w.text("This is a computer-generated receipt and does not need a signature.", { size: 8, color: GREY });
  if (r.reversed) {
    w.watermark("REVERSED");
    w.down(14);
    w.text(`Reversed: ${r.reversalReason ?? ""}`, { size: 9, color: rgb(0.7, 0.1, 0.1) });
  }
  return w.save();
}

export interface InvoicePdfData {
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  outstanding: string;
  notes: string | null;
  institute: InstituteHeader;
  student: { name: string; admissionNo: string; email: string };
  lines: { description: string; quantity: number; unitPrice: string; taxRate: string; amount: string }[];
  discounts: { description: string; amount: string }[];
  installments: { dueDate: Date; amount: string }[];
}

export async function invoicePdf(inv: InvoicePdfData): Promise<Uint8Array> {
  const w = await Writer.create(`Invoice ${inv.number}`);
  w.header(inv.institute, Number(inv.taxTotal) > 0 ? "TAX INVOICE" : "INVOICE");
  w.pair("Invoice no.", inv.number, { bold: true });
  w.pair("Date", isoDay(inv.issueDate));
  if (inv.dueDate) w.pair("Due date", isoDay(inv.dueDate));
  w.pair("Billed to", `${inv.student.name} (${inv.student.admissionNo})`);
  w.down(8);

  const right = A4[0] - MARGIN;
  const head = () => {
    w.text("Description", { bold: true });
    w.text("Qty", { x: 330, bold: true });
    w.text("Rate", { x: 410, bold: true, align: "right" });
    w.text("GST %", { x: 460, bold: true, align: "right" });
    w.text("Amount", { x: right, bold: true, align: "right" });
    w.down(6);
    w.rule();
  };
  head();
  for (const l of inv.lines) {
    w.text(l.description.slice(0, 60));
    w.text(String(l.quantity), { x: 330 });
    w.text(inr(l.unitPrice), { x: 410, align: "right" });
    w.text(Number(l.taxRate).toString(), { x: 460, align: "right" });
    w.text(inr(l.amount), { x: right, align: "right" });
    w.down();
  }
  w.down(4);
  w.rule();
  const total = (label: string, value: string, bold = false) => {
    w.text(label, { x: 330, bold });
    w.text(value, { x: right, align: "right", bold });
    w.down();
  };
  total("Subtotal", inr(inv.subtotal));
  for (const d of inv.discounts) total(`Less: ${d.description}`.slice(0, 40), `-${inr(d.amount)}`);
  if (Number(inv.taxTotal) > 0) total("GST", inr(inv.taxTotal));
  total("Total (Rs.)", inr(inv.total), true);
  total("Paid", inr(inv.amountPaid));
  total("Balance due", inr(inv.outstanding), true);

  if (inv.installments.length) {
    w.down(10);
    w.text("Payment schedule", { bold: true });
    w.down();
    for (const [i, s] of inv.installments.entries()) {
      w.text(`Instalment ${i + 1}: due ${isoDay(s.dueDate)}`);
      w.text(inr(s.amount), { x: right, align: "right" });
      w.down();
    }
  }
  if (inv.notes) {
    w.down(10);
    w.text(inv.notes.slice(0, 200), { size: 9, color: GREY });
  }
  if (inv.status === "VOID") w.watermark("VOID");
  return w.save();
}
