import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { EnrollmentStatus, type Prisma } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { actorStudent } from "../common/actor.js";
import { skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { nextDocumentNumber } from "../common/sequence.js";
import { env } from "../config/env.js";
import { enrollmentFeesCleared } from "../finance/fees-cleared.js";
import { D } from "../finance/money.js";
import { MailService } from "../mail/mail.service.js";
import { type CertificateValues, inspectBackground, renderCertificate, type TemplateField } from "../pdf/certificate.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { cleanFileName } from "../storage/file-types.js";
import { StorageService } from "../storage/storage.service.js";
import { UploadTicketService } from "../storage/upload-ticket.service.js";
import type { CertificatesQuery, CreateTemplateDto, TemplateUploadDto, UpdateTemplateDto } from "./dto.js";

// No 0/O or 1/I: codes are typed in by hand from printed certificates.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function verificationCode(length = 12): string {
  return [...randomBytes(length)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export const verifyUrl = (code: string) => `${env().PLATFORM_URL}/verify/${code}`;

const TEMPLATE_VIEW = {
  id: true,
  name: true,
  backgroundMime: true,
  pageWidth: true,
  pageHeight: true,
  fields: true,
  createdAt: true,
  updatedAt: true,
  courses: { select: { id: true, code: true, name: true } },
  _count: { select: { certificates: true } },
} as const satisfies Prisma.CertificateTemplateSelect;

const CERT_VIEW = {
  id: true,
  serialNo: true,
  verificationCode: true,
  data: true,
  issuedAt: true,
  emailedAt: true,
  revokedAt: true,
  revokeReason: true,
  enrollmentId: true,
  enrollment: { select: { studentId: true, course: { select: { id: true, name: true } } } },
} as const satisfies Prisma.CertificateSelect;

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  certificateId: string | null;
}

/** Sample values for previews, so institutes can position fields before any real issue. */
const SAMPLE: CertificateValues = {
  studentName: "Aditi Venkataraman Krishnamurthy",
  admissionNo: "ADM-00042",
  courseName: "JEE Advanced 2027 (Physics, Chemistry, Mathematics)",
  courseCode: "JEE27",
  batchName: "Morning Batch A",
  durationWeeks: "48",
  completionDate: "2026-10-24",
  issueDate: "2026-10-24",
  serialNo: "CERT-00042",
  instituteName: "Sample Academy",
  teacherName: "Prakash Rao",
  verificationUrl: verifyUrl("SAMPLE2345AB"),
  verificationCode: "SAMPLE2345AB",
};

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tickets: UploadTicketService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ── templates ──

  async requestTemplateUpload(iid: string, dto: TemplateUploadDto) {
    const ext = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[dto.mimeType]!;
    const key = `institutes/${iid}/certificate-templates/${Date.now()}-${verificationCode(6).toLowerCase()}.${ext}`;
    return {
      uploadUrl: await this.storage.presignUpload(key, dto.mimeType, dto.sizeBytes),
      method: "PUT",
      headers: { "Content-Type": dto.mimeType },
      uploadToken: await this.tickets.issue({ key, mimeType: dto.mimeType, size: dto.sizeBytes, fileName: cleanFileName(dto.fileName), scope: "certificate-template", instituteId: iid }),
    };
  }

  /** Saves a template once its background is uploaded; the background must open as a PDF/image. */
  async createTemplate(iid: string, dto: CreateTemplateDto, auth: AuthContext) {
    const t = await this.tickets.verify(dto.uploadToken, { scope: "certificate-template", instituteId: iid });
    const stored = await this.storage.head(t.key);
    if (!stored || stored.size !== t.size || stored.contentType !== t.mimeType) {
      throw new BadRequestException("The background hasn't been uploaded, or doesn't match what was declared");
    }
    let page: { width: number; height: number };
    try {
      page = await inspectBackground(await this.storage.getObject(t.key), t.mimeType);
    } catch {
      await this.storage.delete(t.key).catch(() => undefined);
      throw new BadRequestException("The background file couldn't be read as a PDF or image");
    }
    checkFieldsFit(dto.fields, page);
    return this.prisma.tenant(iid, async (tx) => {
      const tpl = await tx.certificateTemplate.create({
        data: {
          instituteId: iid,
          name: dto.name,
          backgroundKey: t.key,
          backgroundMime: t.mimeType,
          pageWidth: page.width,
          pageHeight: page.height,
          fields: dto.fields as unknown as Prisma.InputJsonValue,
        },
        select: TEMPLATE_VIEW,
      });
      await this.audit.record({ action: "certificate_template.create", entityType: "CertificateTemplate", entityId: tpl.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return tpl;
    });
  }

  listTemplates(iid: string) {
    return this.prisma.tenant(iid, (tx) => tx.certificateTemplate.findMany({ orderBy: { createdAt: "desc" }, select: TEMPLATE_VIEW }));
  }

  getTemplate(iid: string, id: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const tpl = await tx.certificateTemplate.findUnique({ where: { id }, select: TEMPLATE_VIEW });
      if (!tpl) throw new NotFoundException();
      return tpl;
    });
  }

  /** Edits affect certificates rendered from now on; already-generated PDFs keep their look. */
  updateTemplate(iid: string, id: string, dto: UpdateTemplateDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const tpl = await tx.certificateTemplate.findUnique({ where: { id } });
      if (!tpl) throw new NotFoundException();
      if (dto.fields) checkFieldsFit(dto.fields, { width: tpl.pageWidth, height: tpl.pageHeight });
      const updated = await tx.certificateTemplate.update({
        where: { id },
        data: { name: dto.name, fields: dto.fields as unknown as Prisma.InputJsonValue | undefined },
        select: TEMPLATE_VIEW,
      });
      await this.audit.record({ action: "certificate_template.update", entityType: "CertificateTemplate", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
      return updated;
    });
  }

  async deleteTemplate(iid: string, id: string, auth: AuthContext) {
    const key = await this.prisma.tenant(iid, async (tx) => {
      const tpl = await tx.certificateTemplate.findUnique({ where: { id }, select: { backgroundKey: true, _count: { select: { certificates: true, courses: true } } } });
      if (!tpl) throw new NotFoundException();
      if (tpl._count.certificates) throw new ConflictException("Certificates were issued from this template, so it can't be deleted");
      if (tpl._count.courses) throw new ConflictException("Remove this template from its courses first");
      await tx.certificateTemplate.delete({ where: { id } });
      await this.audit.record({ action: "certificate_template.delete", entityType: "CertificateTemplate", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
      return tpl.backgroundKey;
    });
    await this.storage.delete(key).catch(() => undefined);
  }

  /** Renders the template with sample data (long name and course included) to check the layout. */
  async preview(iid: string, id: string): Promise<Uint8Array> {
    const tpl = await this.prisma.tenant(iid, async (tx) => {
      const t = await tx.certificateTemplate.findUnique({ where: { id } });
      if (!t) throw new NotFoundException();
      const inst = await tx.institute.findUniqueOrThrow({ where: { id: iid }, select: { name: true } });
      return { ...t, instituteName: inst.name };
    });
    const bg = await this.storage.getObject(tpl.backgroundKey);
    return renderCertificate(
      { bytes: bg, mime: tpl.backgroundMime, width: tpl.pageWidth, height: tpl.pageHeight },
      tpl.fields as unknown as TemplateField[],
      { ...SAMPLE, instituteName: tpl.instituteName },
    );
  }

  assignToCourse(iid: string, courseId: string, templateId: string | null, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (templateId && !(await tx.certificateTemplate.findUnique({ where: { id: templateId } }))) throw new NotFoundException("Template not found");
      const course = await tx.course.update({ where: { id: courseId }, data: { certificateTemplateId: templateId }, select: { id: true, name: true, certificateTemplateId: true } });
      await this.audit.record({ action: "course.certificate_template", entityType: "Course", entityId: courseId, instituteId: iid, actorUserId: auth.userId, metadata: { templateId } }, tx);
      return course;
    });
  }

  // ── issuing ──

  /** Why an enrollment does or doesn't qualify yet, in words an admin can act on. */
  eligibility(iid: string, enrollmentId: string): Promise<Eligibility> {
    return this.prisma.tenant(iid, (tx) => this.check(tx, enrollmentId));
  }

  private async check(tx: Tx, enrollmentId: string): Promise<Eligibility> {
    const e = await tx.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: true, certificate: { select: { id: true } } } });
    if (!e) throw new NotFoundException("Enrollment not found");
    const reasons: string[] = [];
    if (e.status !== EnrollmentStatus.COMPLETED) reasons.push("The teacher hasn't marked the course complete");
    if (!(await enrollmentFeesCleared(tx, enrollmentId))) {
      const open = await tx.studentInvoice.findMany({ where: { enrollmentId, status: { in: ["ISSUED", "PARTIALLY_PAID", "DRAFT"] } }, select: { total: true, amountPaid: true } });
      const owed = open.reduce((a, i) => a.add(D(i.total).sub(i.amountPaid)), D(0));
      reasons.push(open.length ? `Fees outstanding: ${owed.toFixed(2)}` : "The course fee hasn't been invoiced");
    }
    if (!e.course.certificateTemplateId) reasons.push("The course has no certificate template");
    return { eligible: reasons.length === 0 && !e.certificate, reasons, certificateId: e.certificate?.id ?? null };
  }

  /**
   * Issues the certificate if — and only if — the course is complete, fees are fully paid and
   * a template is set. Called after a completion and after every payment that clears an invoice;
   * safe to call repeatedly. The PDF is rendered and emailed afterwards, outside the transaction.
   */
  async issueIfEligible(iid: string, enrollmentId: string, actorUserId?: string): Promise<Eligibility> {
    const result = await this.prisma.tenant(iid, async (tx) => {
      // Serialises concurrent triggers (completion and final payment at once) for this enrollment.
      await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id = ${enrollmentId}::uuid FOR UPDATE`;
      const status = await this.check(tx, enrollmentId);
      if (!status.eligible) return status;

      const e = await tx.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        include: {
          course: true,
          batch: true,
          student: { include: { membership: { include: { user: true } } } },
          completedBy: { include: { user: true } },
        },
      });
      const institute = await tx.institute.findUniqueOrThrow({ where: { id: iid } });
      const serialNo = await nextDocumentNumber(tx, iid, "CERTIFICATE");
      const code = verificationCode();
      const today = new Date().toISOString().slice(0, 10);
      const data: CertificateValues = {
        studentName: e.student.membership.user.name,
        admissionNo: e.student.admissionNo,
        courseName: e.course.name,
        courseCode: e.course.code,
        batchName: e.batch.name,
        durationWeeks: e.course.durationWeeks ? String(e.course.durationWeeks) : "",
        completionDate: (e.completedAt ?? new Date()).toISOString().slice(0, 10),
        issueDate: today,
        serialNo,
        instituteName: institute.name,
        teacherName: e.completedBy?.user.name ?? "",
        verificationUrl: verifyUrl(code),
        verificationCode: code,
      };
      const cert = await tx.certificate.create({
        data: { instituteId: iid, enrollmentId, templateId: e.course.certificateTemplateId!, serialNo, verificationCode: code, data: data as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record({ action: "certificate.issue", entityType: "Certificate", entityId: cert.id, instituteId: iid, actorUserId, metadata: { serialNo } }, tx);
      return { eligible: true, reasons: [], certificateId: cert.id };
    });
    if (result.eligible && result.certificateId) {
      await this.deliver(iid, result.certificateId).catch((err) => this.logger.error(`Certificate ${result.certificateId} issued but not delivered: ${(err as Error).message}`));
    }
    return result;
  }

  /** Never lets a certificate problem fail the request that triggered it (completion, payment). */
  async afterTrigger(iid: string, enrollmentId: string, actorUserId?: string): Promise<Eligibility | null> {
    try {
      return await this.issueIfEligible(iid, enrollmentId, actorUserId);
    } catch (err) {
      this.logger.error(`Certificate check for enrollment ${enrollmentId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Renders the PDF if it doesn't exist yet and emails it if it hasn't been sent. Idempotent. */
  async deliver(iid: string, certificateId: string, opts: { resend?: boolean } = {}) {
    const { pdf, cert } = await this.ensurePdf(iid, certificateId);
    if (cert.emailedAt && !opts.resend) return;
    const values = cert.data as unknown as CertificateValues;
    const recipients = await this.prisma.tenant(iid, async (tx) => {
      const s = await tx.student.findUniqueOrThrow({ where: { id: cert.enrollment.studentId }, include: { membership: { include: { user: true } } } });
      return [...new Set([s.membership.user.email, s.guardianEmail].filter((x): x is string => !!x))];
    });
    const text =
      `Dear ${values.studentName},\n\nCongratulations on completing ${values.courseName} at ${values.instituteName}. ` +
      `Your certificate (${values.serialNo}) is attached.\n\nAnyone can check it is genuine at:\n${values.verificationUrl}\n\n${values.instituteName}`;
    for (const to of recipients) {
      await this.mail.send({
        to,
        subject: `Your certificate for ${values.courseName}`,
        text,
        attachments: [{ filename: `${values.serialNo}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" }],
      });
    }
    await this.prisma.tenant(iid, (tx) => tx.certificate.update({ where: { id: certificateId }, data: { emailedAt: new Date() } }));
  }

  private async ensurePdf(iid: string, certificateId: string) {
    const cert = await this.prisma.tenant(iid, (tx) =>
      tx.certificate.findUnique({ where: { id: certificateId }, include: { template: true, enrollment: { select: { studentId: true } } } }),
    );
    if (!cert) throw new NotFoundException();
    if (cert.pdfKey) return { cert, pdf: await this.storage.getObject(cert.pdfKey) };

    const t = cert.template;
    const pdf = await renderCertificate(
      { bytes: await this.storage.getObject(t.backgroundKey), mime: t.backgroundMime, width: t.pageWidth, height: t.pageHeight },
      t.fields as unknown as TemplateField[],
      cert.data as unknown as CertificateValues,
    );
    const key = `institutes/${iid}/certificates/${cert.id}.pdf`;
    await this.storage.putObject(key, pdf, "application/pdf");
    await this.prisma.tenant(iid, (tx) => tx.certificate.update({ where: { id: cert.id }, data: { pdfKey: key } }));
    return { cert: { ...cert, pdfKey: key }, pdf };
  }

  // ── reading ──

  list(iid: string, q: CertificatesQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.CertificateWhereInput = {
        enrollment: { courseId: q.courseId, studentId: q.studentId },
        ...(q.search && {
          OR: [
            { serialNo: { contains: q.search, mode: "insensitive" } },
            { enrollment: { student: { membership: { user: { name: { contains: q.search, mode: "insensitive" } } } } } },
          ],
        }),
      };
      const items = await tx.certificate.findMany({ where, select: CERT_VIEW, orderBy: { issuedAt: "desc" }, ...skipTake(q) });
      const total = await tx.certificate.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async download(iid: string, id: string) {
    const { cert } = await this.ensurePdf(iid, id);
    return this.link(cert.pdfKey!, cert.serialNo);
  }

  myCertificates(iid: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const me = await actorStudent(tx, auth);
      return tx.certificate.findMany({ where: { enrollment: { studentId: me.id } }, select: CERT_VIEW, orderBy: { issuedAt: "desc" } });
    });
  }

  async myDownload(iid: string, id: string, auth: AuthContext) {
    await this.prisma.tenant(iid, async (tx) => {
      const me = await actorStudent(tx, auth);
      const c = await tx.certificate.findUnique({ where: { id }, include: { enrollment: { select: { studentId: true } } } });
      if (!c || c.enrollment.studentId !== me.id) throw new NotFoundException();
      if (c.revokedAt) throw new BadRequestException("This certificate has been revoked");
    });
    return this.download(iid, id);
  }

  async resend(iid: string, id: string) {
    await this.deliver(iid, id, { resend: true });
  }

  revoke(iid: string, id: string, reason: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const c = await tx.certificate.findUnique({ where: { id } });
      if (!c) throw new NotFoundException();
      if (c.revokedAt) throw new BadRequestException("Already revoked");
      const updated = await tx.certificate.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason }, select: CERT_VIEW });
      await this.audit.record({ action: "certificate.revoke", entityType: "Certificate", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { reason } }, tx);
      return updated;
    });
  }

  /**
   * Public check of a printed certificate. Shows only what is printed on it (name, course,
   * dates, serial) and whether it is still valid; nothing else about the student.
   */
  async verify(code: string) {
    const c = await this.prisma.platform.certificate.findUnique({ where: { verificationCode: code } });
    if (!c) throw new NotFoundException("No certificate with this code");
    const v = c.data as unknown as CertificateValues;
    return {
      valid: !c.revokedAt,
      revoked: !!c.revokedAt,
      serialNo: c.serialNo,
      studentName: v.studentName,
      courseName: v.courseName,
      instituteName: v.instituteName,
      completionDate: v.completionDate,
      issuedAt: c.issuedAt.toISOString().slice(0, 10),
    };
  }

  private async link(key: string, serialNo: string) {
    const ttl = 5 * 60;
    return { url: await this.storage.presignDownload(key, { fileName: `${serialNo}.pdf`, ttlSeconds: ttl }), expiresAt: new Date(Date.now() + ttl * 1000) };
  }
}

function checkFieldsFit(fields: TemplateField[], page: { width: number; height: number }) {
  for (const [i, f] of fields.entries()) {
    if (f.x > page.width || f.y > page.height) {
      throw new BadRequestException(`Field ${i + 1} is outside the page (${Math.round(page.width)} × ${Math.round(page.height)} pt)`);
    }
  }
}
