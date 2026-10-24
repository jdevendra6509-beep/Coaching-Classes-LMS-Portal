import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { Role } from "@lms/db";
import { acceptInviteAndLogin, createTestApp, createUser, login, setupInstitute, unique, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const email = () => `${unique("c")}@example.in`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Whether `text` was drawn on the page. pdf-lib deflates content streams and writes strings as
 * hex, so inflate every stream and look for the hex form.
 */
function printed(pdf: Uint8Array, text: string): boolean {
  const raw = Buffer.from(pdf);
  const needle = `<${Buffer.from(text, "latin1").toString("hex").toUpperCase()}>`;
  let at = 0;
  while ((at = raw.indexOf("stream", at)) !== -1) {
    const start = at + (raw[at + 6] === 0x0d ? 8 : 7);
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    try {
      if (inflateSync(raw.subarray(start, end)).toString("latin1").includes(needle)) return true;
    } catch {
      // not a deflated stream (e.g. an image)
    }
    at = end + 9;
  }
  return false;
}

async function blankPdf(width = 842, height = 595) {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

const FIELDS = [
  { key: "studentName", x: 421, y: 280, fontSize: 32, font: "Times-Bold", align: "center", maxWidth: 600 },
  { text: "has successfully completed {courseName} on {completionDate}", x: 421, y: 330, fontSize: 14, align: "center", dateFormat: "D MMMM YYYY" },
  { key: "serialNo", x: 60, y: 560, fontSize: 9 },
  { key: "verificationQr", x: 720, y: 460, size: 90 },
];

async function uploadTemplate(h: Record<string, string>, opts: { bytes?: Uint8Array; mime?: string; fields?: object[] } = {}) {
  const bytes = opts.bytes ?? (await blankPdf());
  const mime = opts.mime ?? "application/pdf";
  const ask = await ctx.http().post("/certificate-templates/upload-url").set(h).send({ fileName: "design.pdf", mimeType: mime, sizeBytes: bytes.length });
  ctx.storage.put(ask.body.uploadUrl, bytes.length, mime, bytes);
  return ctx.http().post("/certificate-templates").set(h).send({ name: "Standard", uploadToken: ask.body.uploadToken, fields: opts.fields ?? FIELDS });
}

/** A course with a template, a teacher, and an enrolled student (with guardian) billed ₹10,000. */
async function world(opts: { template?: boolean; bill?: boolean } = {}) {
  const s = await setupInstitute(ctx);
  const h = s.authed();
  const course = (await ctx.http().post("/courses").set(h).send({ code: "NEET", name: "NEET Crash Course", fee: 10000, durationWeeks: 12 })).body;
  const tEmail = email();
  const teacher = (await ctx.http().post("/teachers").set(h).send({ name: "Kavita Joshi", email: tEmail })).body;
  const batch = (await ctx.http().post("/batches").set(h).send({ courseId: course.id, name: "Weekend", startDate: day(-30), teacherIds: [teacher.id] })).body;
  const studentEmail = email();
  const guardianEmail = email();
  const student = (await ctx.http().post("/students").set(h).send({ name: "Riya Sen", email: studentEmail, guardianEmail, batchId: batch.id })).body;
  const enrollmentId = student.enrollments[0].id as string;
  const teacherH = s.authed(await acceptInviteAndLogin(ctx, tEmail, s.inst.slug));
  let template;
  if (opts.template !== false) {
    template = (await uploadTemplate(h)).body;
    await ctx.http().put(`/courses/${course.id}/certificate-template`).set(h).send({ templateId: template.id }).expect(200);
  }
  const invoice = opts.bill !== false ? (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body : null;
  return { ...s, h, course, batch, student, studentEmail, guardianEmail, enrollmentId, teacherH, template, invoice };
}

const pay = (h: Record<string, string>, invoiceId: string, amount: number) =>
  ctx.http().post(`/invoices/${invoiceId}/payments`).set(h).send({ amount, method: "UPI", sendReceipt: false });

const certMail = (to: string) => ctx.mail.sent.filter((m) => m.to === to && m.subject.startsWith("Your certificate"));

describe("certificate templates", () => {
  it("takes a PDF background, reads its page size, and previews with sample data", async () => {
    const h = (await setupInstitute(ctx)).authed();
    const res = await uploadTemplate(h);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Standard", backgroundMime: "application/pdf", pageWidth: 842, pageHeight: 595 });

    const preview = await ctx.http().get(`/certificate-templates/${res.body.id}/preview`).set(h).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toBe("application/pdf");
    const pdf = new Uint8Array(preview.body as Buffer);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(printed(pdf, "Aditi Venkataraman Krishnamurthy")).toBe(true);
    expect(printed(pdf, "Not on this certificate")).toBe(false);
    expect(printed(pdf, "has successfully completed JEE Advanced 2027 (Physics, Chemistry, Mathematics) on 24 October 2026")).toBe(true);
  });

  it("accepts PNG backgrounds as an A4-wide page", async () => {
    const h = (await setupInstitute(ctx)).authed();
    const png = new Uint8Array(await QRCode.toBuffer("background", { width: 400 }));
    const res = await uploadTemplate(h, { bytes: png, mime: "image/png", fields: [{ key: "studentName", x: 100, y: 100 }] });
    expect(res.status).toBe(201);
    expect(res.body.pageWidth).toBe(842);
    expect(res.body.pageHeight).toBe(842); // square image keeps its aspect ratio
  });

  it("rejects unreadable files, fields off the page and bad field definitions", async () => {
    const h = (await setupInstitute(ctx)).authed();
    const junk = new TextEncoder().encode("this is not a pdf at all");
    expect((await uploadTemplate(h, { bytes: junk })).status).toBe(400);
    expect((await uploadTemplate(h, { fields: [{ key: "studentName", x: 900, y: 100 }] })).status).toBe(400);
    expect((await uploadTemplate(h, { fields: [{ key: "notAField", x: 1, y: 1 }] })).status).toBe(400);
    expect((await uploadTemplate(h, { fields: [{ x: 1, y: 1 }] })).status).toBe(400); // neither key nor text
    expect((await uploadTemplate(h, { fields: [{ key: "studentName", x: 1, y: 1, font: "Comic Sans" }] })).status).toBe(400);
    const svg = await ctx.http().post("/certificate-templates/upload-url").set(h).send({ fileName: "x.svg", mimeType: "image/svg+xml", sizeBytes: 10 });
    expect(svg.status).toBe(400);
  });

  it("can't be deleted once used, and is admin-only", async () => {
    const { h, template, teacherH, invoice, enrollmentId } = await world();
    await pay(h, invoice.id, 10000);
    await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH).expect(200);
    expect((await ctx.http().delete(`/certificate-templates/${template.id}`).set(h)).status).toBe(409);
    expect((await ctx.http().get("/certificate-templates").set(teacherH)).status).toBe(403);
  });
});

describe("issuing", () => {
  it("course completed, then fees paid → certificate issued, rendered and emailed with the PDF", async () => {
    const { h, teacherH, enrollmentId, invoice, studentEmail, guardianEmail, inst } = await world();

    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    expect(done.status).toBe(200);
    expect(done.body.certificate).toMatchObject({ eligible: false, reasons: ["Fees outstanding: 10000.00"] });
    expect(certMail(studentEmail)).toHaveLength(0);

    await pay(h, invoice.id, 4000).expect(201);
    expect(certMail(studentEmail)).toHaveLength(0); // still owes 6,000
    await pay(h, invoice.id, 6000).expect(201);

    const [mail] = certMail(studentEmail);
    expect(mail.subject).toBe("Your certificate for NEET Crash Course");
    expect(mail.text).toContain("CERT-00001");
    expect(mail.attachments![0]).toMatchObject({ filename: "CERT-00001.pdf", contentType: "application/pdf" });
    const pdf = new Uint8Array(mail.attachments![0].content);
    expect(printed(pdf, "Riya Sen")).toBe(true);
    expect(printed(pdf, "CERT-00001")).toBe(true);
    expect(certMail(guardianEmail)).toHaveLength(1);

    const list = (await ctx.http().get("/certificates").set(h)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ serialNo: "CERT-00001", revokedAt: null });
    expect(list.items[0].data).toMatchObject({ studentName: "Riya Sen", teacherName: "Kavita Joshi", instituteName: inst.name });

    const sH = (await setupStudentLogin(studentEmail, inst.slug)).h;
    const mine = (await ctx.http().get("/me/certificates").set(sH)).body;
    expect(mine.map((c: { serialNo: string }) => c.serialNo)).toEqual(["CERT-00001"]);
    const dl = await ctx.http().get(`/me/certificates/${mine[0].id}/download`).set(sH);
    expect(dl.body.url).toContain("CERT-00001.pdf");
  });

  it("fees paid first, then completion → issued at completion", async () => {
    const { h, teacherH, enrollmentId, invoice, studentEmail } = await world();
    await pay(h, invoice.id, 10000).expect(201);
    expect(certMail(studentEmail)).toHaveLength(0); // paid but not complete

    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    expect(done.body.certificate).toMatchObject({ eligible: true, reasons: [] });
    expect(certMail(studentEmail)).toHaveLength(1);
  });

  it("explains what's missing, and issues on request once a template is added", async () => {
    const { h, teacherH, enrollmentId, invoice, course, studentEmail } = await world({ template: false });
    await pay(h, invoice.id, 10000);
    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    expect(done.body.certificate.reasons).toEqual(["The course has no certificate template"]);

    const template = (await uploadTemplate(h)).body;
    await ctx.http().put(`/courses/${course.id}/certificate-template`).set(h).send({ templateId: template.id }).expect(200);
    const status = await ctx.http().get(`/enrollments/${enrollmentId}/certificate-status`).set(h);
    expect(status.body).toMatchObject({ eligible: true, reasons: [], certificateId: null });

    const issued = await ctx.http().post(`/enrollments/${enrollmentId}/certificate`).set(h);
    expect(issued.body.eligible).toBe(true);
    expect(certMail(studentEmail)).toHaveLength(1);
  });

  it("an unbilled course with a fee does not release a certificate", async () => {
    const { teacherH, enrollmentId } = await world({ bill: false });
    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    expect(done.body.certificate.reasons).toEqual(["The course fee hasn't been invoiced"]);
  });

  it("issues exactly one certificate even when triggered repeatedly or concurrently", async () => {
    const { h, teacherH, enrollmentId, invoice, inst } = await world();
    await pay(h, invoice.id, 10000);
    await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH).expect(200);
    await Promise.all([1, 2, 3].map(() => ctx.http().post(`/enrollments/${enrollmentId}/certificate`).set(h)));
    expect(await ctx.db.certificate.count({ where: { instituteId: inst.id } })).toBe(1);
  });

  it("a storage failure while rendering doesn't lose the certificate; the PDF is made on first download", async () => {
    const { h, teacherH, enrollmentId, invoice, template, studentEmail } = await world();
    const bgKey = (await ctx.db.certificateTemplate.findUniqueOrThrow({ where: { id: template.id } })).backgroundKey;
    const bg = ctx.storage.bodies.get(bgKey)!;
    ctx.storage.bodies.delete(bgKey); // background temporarily unreadable

    await pay(h, invoice.id, 10000);
    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    expect(done.status).toBe(200);
    const cert = await ctx.db.certificate.findFirstOrThrow({ where: { enrollmentId } });
    expect(cert.pdfKey).toBeNull();
    expect(certMail(studentEmail)).toHaveLength(0);

    ctx.storage.bodies.set(bgKey, bg);
    const dl = await ctx.http().get(`/certificates/${cert.id}/download`).set(h);
    expect(dl.status).toBe(200);
    expect((await ctx.db.certificate.findUniqueOrThrow({ where: { id: cert.id } })).pdfKey).toBe(`institutes/${cert.instituteId}/certificates/${cert.id}.pdf`);
    await ctx.http().post(`/certificates/${cert.id}/resend`).set(h).expect(204);
    expect(certMail(studentEmail)).toHaveLength(1);
  });
});

describe("verification and revocation", () => {
  it("anyone can verify by code; details are frozen at issue; revoked certificates show as invalid", async () => {
    const { h, teacherH, enrollmentId, invoice, studentEmail, inst, student } = await world();
    await pay(h, invoice.id, 10000);
    await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(teacherH);
    const cert = await ctx.db.certificate.findFirstOrThrow({ where: { enrollmentId } });
    expect(cert.verificationCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(certMail(studentEmail)[0].text).toContain(`http://lvh.me:3000/verify/${cert.verificationCode}`);

    const ok = await ctx.http().get(`/public/certificates/${cert.verificationCode.toLowerCase()}`);
    expect(ok.body).toEqual({
      valid: true, revoked: false, serialNo: "CERT-00001", studentName: "Riya Sen", courseName: "NEET Crash Course",
      instituteName: inst.name, completionDate: day(0), issuedAt: day(0),
    });

    await ctx.db.user.update({ where: { email: studentEmail }, data: { name: "Renamed Later" } });
    expect((await ctx.http().get(`/public/certificates/${cert.verificationCode}`)).body.studentName).toBe("Riya Sen");
    expect((await ctx.http().get("/public/certificates/NOSUCHCODE22")).status).toBe(404);

    // Once issued, the completion can't be undone; the certificate is revoked instead.
    expect((await ctx.http().post(`/enrollments/${enrollmentId}/reopen`).set(h)).status).toBe(400);
    await ctx.http().post(`/certificates/${cert.id}/revoke`).set(h).send({ reason: "Issued in error" }).expect(200);
    expect((await ctx.http().get(`/public/certificates/${cert.verificationCode}`)).body).toMatchObject({ valid: false, revoked: true });
    const sH = (await setupStudentLogin(studentEmail, inst.slug)).h;
    expect((await ctx.http().get(`/me/certificates/${cert.id}/download`).set(sH)).status).toBe(400);
    expect(student.id).toBeTruthy();
  });

  it("students only reach their own certificates; institutes only theirs", async () => {
    const a = await world();
    const b = await world();
    await pay(a.h, a.invoice.id, 10000);
    await ctx.http().post(`/enrollments/${a.enrollmentId}/complete`).set(a.teacherH);
    const cert = await ctx.db.certificate.findFirstOrThrow({ where: { enrollmentId: a.enrollmentId } });

    const otherEmail = email();
    await ctx.http().post("/students").set(a.h).send({ name: "Someone Else", email: otherEmail, batchId: a.batch.id }).expect(201);
    const oH = (await setupStudentLogin(otherEmail, a.inst.slug)).h;
    expect((await ctx.http().get(`/me/certificates/${cert.id}/download`).set(oH)).status).toBe(404);
    expect((await ctx.http().get("/me/certificates").set(oH)).body).toEqual([]);

    expect((await ctx.http().get(`/certificates/${cert.id}/download`).set(b.h)).status).toBe(404);
    expect((await ctx.http().put(`/courses/${b.course.id}/certificate-template`).set(b.h).send({ templateId: a.template.id })).status).toBe(404);
    expect((await ctx.http().post(`/certificates/${cert.id}/revoke`).set(b.h).send({ reason: "malice" })).status).toBe(404);
  });
});

describe("receipt and invoice PDFs", () => {
  const asBuffer = (r: import("supertest").Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  it("renders the invoice and receipt, and attaches the receipt PDF to the receipt email", async () => {
    const { h, invoice, studentEmail, inst } = await world({ template: false });
    const p = (await ctx.http().post(`/invoices/${invoice.id}/payments`).set(h).send({ amount: 125000 / 25, method: "CHEQUE", reference: "CHQ 991" })).body;

    const receipt = await asBuffer(ctx.http().get(`/payments/${p.id}/receipt.pdf`).set(h));
    expect(receipt.headers["content-type"]).toBe("application/pdf");
    const rpdf = new Uint8Array(receipt.body as Buffer);
    expect(printed(rpdf, "Rs. 5,000.00")).toBe(true);
    expect(printed(rpdf, "Rupees Five Thousand Only")).toBe(true);
    const mailed = ctx.mail.sent.filter((m) => m.to === studentEmail && m.subject.startsWith("Fee receipt")).at(-1)!;
    expect(mailed.attachments![0].filename).toBe(`${p.receiptNo}.pdf`);

    const inv = new Uint8Array((await asBuffer(ctx.http().get(`/invoices/${invoice.id}/pdf`).set(h))).body as Buffer);
    expect(printed(inv, invoice.number)).toBe(true);
    expect(printed(inv, "5,000.00")).toBe(true); // balance due

    const sH = (await setupStudentLogin(studentEmail, inst.slug)).h;
    expect((await ctx.http().get(`/me/invoices/${invoice.id}/pdf`).set(sH)).status).toBe(200);
    expect((await ctx.http().get(`/me/payments/${p.id}/receipt.pdf`).set(sH)).status).toBe(200);
  });

  it("drafts have no PDF; other students and other roles can't fetch one", async () => {
    const { h, enrollmentId, invoice, inst, batch } = await world({ template: false });
    await ctx.http().post(`/invoices/${invoice.id}/void`).set(h).send({ reason: "redo" }).expect(200);
    const draft = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId, issue: false })).body;
    expect((await ctx.http().get(`/invoices/${draft.id}/pdf`).set(h)).status).toBe(400);

    const otherEmail = email();
    await ctx.http().post("/students").set(h).send({ name: "Nosy Student", email: otherEmail, batchId: batch.id }).expect(201);
    const oH = (await setupStudentLogin(otherEmail, inst.slug)).h;
    expect((await ctx.http().get(`/me/invoices/${invoice.id}/pdf`).set(oH)).status).toBe(404);

    const teacher = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.TEACHER] });
    const tH = { Authorization: `Bearer ${(await login(ctx, teacher.email, inst.slug)).token}`, "X-Institute-Slug": inst.slug };
    expect((await ctx.http().get(`/invoices/${invoice.id}/pdf`).set(tH)).status).toBe(403);
  });
});

async function setupStudentLogin(studentEmail: string, slug: string) {
  const token = await acceptInviteAndLogin(ctx, studentEmail, slug);
  return { h: { Authorization: `Bearer ${token}`, "X-Institute-Slug": slug } };
}
