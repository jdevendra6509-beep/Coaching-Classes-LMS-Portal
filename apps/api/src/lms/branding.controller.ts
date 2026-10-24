import { BadRequestException, Body, Controller, Get, HttpCode, Logger, NotFoundException, Param, Post } from "@nestjs/common";
import { InstituteStatus, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { Auth, InstituteId, Public, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "../storage/file-types.js";
import { StorageService } from "../storage/storage.service.js";
import { UploadTicketService } from "../storage/upload-ticket.service.js";
import { ConfirmLogoDto, LogoUploadDto } from "./dto.js";
import { storageUsage } from "./materials.service.js";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const OPEN: InstituteStatus[] = [InstituteStatus.ACTIVE, InstituteStatus.PAST_DUE];

@Controller()
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tickets: UploadTicketService,
    private readonly audit: AuditService,
  ) {}

  /** Name and logo for an institute's login page. Only for institutes that are open for sign-in. */
  @Public()
  @Get("public/institutes/:slug")
  async publicProfile(@Param("slug") slug: string) {
    const inst = await this.prisma.platform.institute.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!inst || !OPEN.includes(inst.status)) throw new NotFoundException();
    const logoUrl = inst.logoKey ? await this.storage.presignDownload(inst.logoKey, { inline: true, ttlSeconds: 60 * 60 }) : null;
    return { slug: inst.slug, name: inst.name, logoUrl };
  }

  @Roles(Role.INSTITUTE_ADMIN)
  @Get("institute/storage")
  storageUsage(@InstituteId() iid: string) {
    return this.prisma.tenant(iid, (tx) => storageUsage(tx));
  }

  @Roles(Role.INSTITUTE_ADMIN)
  @Post("institute/logo/upload-url")
  @HttpCode(200)
  async logoUploadUrl(@InstituteId() iid: string, @Body() dto: LogoUploadDto) {
    if (!LOGO_TYPES.includes(dto.mimeType)) throw new BadRequestException("The logo must be a PNG, JPEG or WebP image");
    if (dto.sizeBytes > LOGO_MAX_BYTES) throw new BadRequestException("The logo must be 2 MB or smaller");
    const key = `institutes/${iid}/branding/logo-${Date.now()}.${EXT[dto.mimeType]}`;
    return {
      uploadUrl: await this.storage.presignUpload(key, dto.mimeType, dto.sizeBytes),
      method: "PUT",
      headers: { "Content-Type": dto.mimeType },
      uploadToken: await this.tickets.issue({ key, mimeType: dto.mimeType, size: dto.sizeBytes, fileName: `logo.${EXT[dto.mimeType]}`, scope: "logo", instituteId: iid }),
    };
  }

  @Roles(Role.INSTITUTE_ADMIN)
  @Post("institute/logo")
  @HttpCode(200)
  async confirmLogo(@InstituteId() iid: string, @Body() dto: ConfirmLogoDto, @Auth() auth: AuthContext) {
    const t = await this.tickets.verify(dto.uploadToken, { scope: "logo", instituteId: iid });
    const stored = await this.storage.head(t.key);
    if (!stored || stored.size !== t.size || stored.contentType !== t.mimeType) {
      throw new BadRequestException("The logo hasn't been uploaded, or doesn't match what was declared");
    }
    const previous = await this.prisma.tenant(iid, async (tx) => {
      const { logoKey } = await tx.institute.findUniqueOrThrow({ where: { id: iid } });
      await tx.institute.update({ where: { id: iid }, data: { logoKey: t.key } });
      await this.audit.record({ action: "institute.logo", entityType: "Institute", entityId: iid, instituteId: iid, actorUserId: auth.userId }, tx);
      return logoKey;
    });
    if (previous && previous !== t.key) {
      await this.storage.delete(previous).catch((err) => this.logger.warn(`Old logo not deleted: ${(err as Error).message}`));
    }
    return { logoUrl: await this.storage.presignDownload(t.key, { inline: true, ttlSeconds: 60 * 60 }) };
  }
}
