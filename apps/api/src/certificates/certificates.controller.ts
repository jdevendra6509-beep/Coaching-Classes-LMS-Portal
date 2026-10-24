import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@lms/db";
import { Auth, InstituteId, Public, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { CertificatesService } from "./certificates.service.js";
import { AssignTemplateDto, CertificatesQuery, CreateTemplateDto, RevokeDto, TemplateUploadDto, UpdateTemplateDto, VerifyParam } from "./dto.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  // ── templates ──

  @Post("certificate-templates/upload-url")
  @HttpCode(200)
  uploadUrl(@InstituteId() iid: string, @Body() dto: TemplateUploadDto) {
    return this.certificates.requestTemplateUpload(iid, dto);
  }

  @Post("certificate-templates")
  createTemplate(@InstituteId() iid: string, @Body() dto: CreateTemplateDto, @Auth() auth: AuthContext) {
    return this.certificates.createTemplate(iid, dto, auth);
  }

  @Get("certificate-templates")
  templates(@InstituteId() iid: string) {
    return this.certificates.listTemplates(iid);
  }

  @Get("certificate-templates/:id")
  template(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.certificates.getTemplate(iid, id);
  }

  @Patch("certificate-templates/:id")
  updateTemplate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto, @Auth() auth: AuthContext) {
    return this.certificates.updateTemplate(iid, id, dto, auth);
  }

  @Delete("certificate-templates/:id")
  @HttpCode(204)
  deleteTemplate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.certificates.deleteTemplate(iid, id, auth);
  }

  /** The template filled with sample data, as a PDF, to check field positions. */
  @Get("certificate-templates/:id/preview")
  async preview(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    const pdf = await this.certificates.preview(iid, id);
    return new StreamableFile(Buffer.from(pdf), { type: "application/pdf", disposition: 'inline; filename="certificate-preview.pdf"' });
  }

  @Put("courses/:id/certificate-template")
  assign(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AssignTemplateDto, @Auth() auth: AuthContext) {
    return this.certificates.assignToCourse(iid, id, dto.templateId, auth);
  }

  // ── certificates ──

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get("enrollments/:id/certificate-status")
  status(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.certificates.eligibility(iid, id);
  }

  /** Issues now if everything is in place, e.g. after a template is added to a course. */
  @Post("enrollments/:id/certificate")
  @HttpCode(200)
  issue(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.certificates.issueIfEligible(iid, id, auth.userId);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT)
  @Get("certificates")
  list(@InstituteId() iid: string, @Query() q: CertificatesQuery) {
    return this.certificates.list(iid, q);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT)
  @Get("certificates/:id/download")
  download(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.certificates.download(iid, id);
  }

  @Post("certificates/:id/resend")
  @HttpCode(204)
  resend(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.certificates.resend(iid, id);
  }

  @Post("certificates/:id/revoke")
  @HttpCode(200)
  revoke(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Auth() auth: AuthContext) {
    return this.certificates.revoke(iid, id, dto.reason, auth);
  }
}

@Roles(Role.STUDENT)
@Controller("me/certificates")
export class StudentCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  list(@InstituteId() iid: string, @Auth() auth: AuthContext) {
    return this.certificates.myCertificates(iid, auth);
  }

  @Get(":id/download")
  download(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.certificates.myDownload(iid, id, auth);
  }
}

/** Behind the QR code on every certificate. */
@Public()
@Controller("public/certificates")
export class VerifyController {
  constructor(private readonly certificates: CertificatesService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":code")
  verify(@Param() p: VerifyParam) {
    return this.certificates.verify(p.code);
  }
}
