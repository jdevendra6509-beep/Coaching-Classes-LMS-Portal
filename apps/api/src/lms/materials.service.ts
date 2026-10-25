import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MaterialType, type Material, type Prisma, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { actorMembership } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { checkFile, cleanFileName } from "../storage/file-types.js";
import { StorageService } from "../storage/storage.service.js";
import { UploadTicketService } from "../storage/upload-ticket.service.js";
import { assertCanManageCourse, assertStudentEnrolled } from "./access.js";
import type { CreateMaterialDto, ModuleDto, OrderMaterialsDto, UpdateMaterialDto, UploadRequestDto } from "./dto.js";

const MATERIAL_FIELDS = {
  id: true,
  title: true,
  description: true,
  type: true,
  moduleId: true,
  position: true,
  isPublished: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  externalUrl: true,
  createdAt: true,
  uploadedBy: { select: { user: { select: { name: true } } } },
} as const satisfies Prisma.MaterialSelect;

type MaterialRow = Prisma.MaterialGetPayload<{ select: typeof MATERIAL_FIELDS }>;

/** BigInt doesn't serialise to JSON; files are far below 2^53 bytes. */
function view(m: MaterialRow, forStudent = false) {
  const { sizeBytes, uploadedBy, externalUrl, ...rest } = m;
  return {
    ...rest,
    sizeBytes: sizeBytes === null ? null : Number(sizeBytes),
    uploadedBy: uploadedBy.user.name,
    // Students get links through the download endpoint like everything else.
    ...(forStudent ? {} : { externalUrl }),
  };
}

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tickets: UploadTicketService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Step 1 of an upload: checks type, size and storage quota, then returns a URL the browser PUTs
   * the file to (directly to storage, not through the API) and a ticket for step 2.
   */
  requestUpload(iid: string, courseId: string, dto: UploadRequestDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      const fileName = cleanFileName(dto.fileName);
      const check = checkFile(fileName, dto.mimeType, dto.sizeBytes);
      if ("error" in check) throw new BadRequestException(check.error);
      await assertStorageQuota(tx, dto.sizeBytes);

      const ext = fileName.toLowerCase().split(".").pop();
      const key = `institutes/${iid}/courses/${courseId}/${randomUUID()}.${ext}`;
      const uploadUrl = await this.storage.presignUpload(key, dto.mimeType, dto.sizeBytes);
      const uploadToken = await this.tickets.issue({ key, mimeType: dto.mimeType, size: dto.sizeBytes, fileName, scope: `course:${courseId}`, instituteId: iid });
      return {
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": dto.mimeType },
        uploadToken,
        expiresInSeconds: 15 * 60,
      };
    });
  }

  /** Step 2: records the material once the file is in storage, or saves a link. */
  async create(iid: string, courseId: string, dto: CreateMaterialDto, auth: AuthContext) {
    let file: { key: string; mimeType: string; size: number; fileName: string; type: MaterialType } | undefined;
    if (dto.uploadToken) {
      const t = await this.tickets.verify(dto.uploadToken, { scope: `course:${courseId}`, instituteId: iid });
      const stored = await this.storage.head(t.key);
      if (!stored) throw new BadRequestException("The file hasn't been uploaded yet");
      if (stored.size !== t.size || stored.contentType !== t.mimeType) {
        await this.storage.delete(t.key).catch(() => undefined);
        throw new BadRequestException("The uploaded file doesn't match what was declared; please upload it again");
      }
      const check = checkFile(t.fileName, t.mimeType, t.size);
      if ("error" in check) throw new BadRequestException(check.error);
      file = { key: t.key, mimeType: t.mimeType, size: t.size, fileName: t.fileName, type: check.type };
    }

    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      if (dto.moduleId) await this.moduleOf(tx, dto.moduleId, courseId);
      if (file) await assertStorageQuota(tx, file.size);
      const by = await actorMembership(tx, auth, [Role.TEACHER, Role.INSTITUTE_ADMIN]);
      const last = await tx.material.aggregate({ where: { courseId, moduleId: dto.moduleId ?? null }, _max: { position: true } });

      const material = await tx.material.create({
        data: {
          instituteId: iid,
          courseId,
          moduleId: dto.moduleId,
          title: dto.title,
          description: dto.description,
          isPublished: dto.isPublished ?? false,
          position: (last._max.position ?? -1) + 1,
          uploadedById: by.id,
          ...(file
            ? { type: file.type, storageKey: file.key, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: BigInt(file.size) }
            : { type: dto.linkType ?? MaterialType.LINK, externalUrl: dto.externalUrl }),
        },
        select: MATERIAL_FIELDS,
      });
      await this.audit.record({ action: "material.create", entityType: "Material", entityId: material.id, instituteId: iid, actorUserId: auth.userId, metadata: { courseId, type: material.type } }, tx);
      return view(material);
    });
  }

  /** Staff view: every material, published or not, grouped by module in display order. */
  listForStaff(iid: string, courseId: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      return this.outline(tx, courseId, {});
    });
  }

  listForStudent(iid: string, courseId: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertStudentEnrolled(tx, auth, courseId);
      const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { id: true, code: true, name: true, description: true } });
      return { course, ...(await this.outline(tx, courseId, { isPublished: true }, true)) };
    });
  }

  update(iid: string, id: string, dto: UpdateMaterialDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const m = await this.find(tx, id);
      await assertCanManageCourse(tx, auth, m.courseId);
      if (dto.moduleId) await this.moduleOf(tx, dto.moduleId, m.courseId);
      const moving = dto.moduleId !== undefined && dto.moduleId !== m.moduleId;
      const position = moving
        ? ((await tx.material.aggregate({ where: { courseId: m.courseId, moduleId: dto.moduleId ?? null }, _max: { position: true } }))._max.position ?? -1) + 1
        : undefined;
      const updated = await tx.material.update({
        where: { id },
        data: { title: dto.title, description: dto.description, isPublished: dto.isPublished, moduleId: dto.moduleId, position },
        select: MATERIAL_FIELDS,
      });
      await this.audit.record({ action: "material.update", entityType: "Material", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return view(updated);
    });
  }

  /** Removes the record, then the stored file (after commit, so a rollback never loses a file). */
  async remove(iid: string, id: string, auth: AuthContext) {
    const key = await this.prisma.tenant(iid, async (tx) => {
      const m = await this.find(tx, id);
      await assertCanManageCourse(tx, auth, m.courseId);
      await tx.material.delete({ where: { id } });
      await this.audit.record({ action: "material.delete", entityType: "Material", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { title: m.title } }, tx);
      return m.storageKey;
    });
    if (key) {
      // TODO(worker): retry failed deletes from a queue; an orphaned object only costs storage.
      await this.storage.delete(key).catch((err) => this.logger.warn(`Could not delete ${key}: ${(err as Error).message}`));
    }
  }

  order(iid: string, courseId: string, dto: OrderMaterialsDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      const inGroup = await tx.material.findMany({ where: { courseId, moduleId: dto.moduleId }, select: { id: true } });
      const ids = new Set(inGroup.map((m) => m.id));
      if (ids.size !== dto.materialIds.length || !dto.materialIds.every((m) => ids.has(m))) {
        throw new BadRequestException("List every material of that module exactly once");
      }
      for (const [position, id] of dto.materialIds.entries()) await tx.material.update({ where: { id }, data: { position } });
      return this.outline(tx, courseId, {});
    });
  }

  /** A short-lived URL for the file (or the link itself). Staff: any material of a course they manage. */
  async downloadForStaff(iid: string, id: string, inline: boolean, auth: AuthContext) {
    const m = await this.prisma.tenant(iid, async (tx) => {
      const m = await this.find(tx, id);
      await assertCanManageCourse(tx, auth, m.courseId);
      return m;
    });
    return this.link(m, inline);
  }

  /** Students: only published materials of courses they're enrolled in. */
  async downloadForStudent(iid: string, id: string, inline: boolean, auth: AuthContext) {
    const m = await this.prisma.tenant(iid, async (tx) => {
      const m = await tx.material.findUnique({ where: { id } });
      if (!m || !m.isPublished) throw new NotFoundException();
      await assertStudentEnrolled(tx, auth, m.courseId);
      return m;
    });
    return this.link(m, inline);
  }

  // ── modules ──

  createModule(iid: string, courseId: string, dto: ModuleDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      const last = await tx.courseModule.aggregate({ where: { courseId }, _max: { position: true } });
      return tx.courseModule.create({
        data: { instituteId: iid, courseId, title: dto.title, position: (last._max.position ?? -1) + 1 },
        select: { id: true, title: true, position: true },
      });
    });
  }

  renameModule(iid: string, id: string, dto: ModuleDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const mod = await tx.courseModule.findUnique({ where: { id } });
      if (!mod) throw new NotFoundException();
      await assertCanManageCourse(tx, auth, mod.courseId);
      return tx.courseModule.update({ where: { id }, data: { title: dto.title }, select: { id: true, title: true, position: true } });
    });
  }

  /** Deleting a module keeps its materials; they move to the end of the ungrouped list. */
  deleteModule(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const mod = await tx.courseModule.findUnique({ where: { id } });
      if (!mod) throw new NotFoundException();
      await assertCanManageCourse(tx, auth, mod.courseId);
      const last = await tx.material.aggregate({ where: { courseId: mod.courseId, moduleId: null }, _max: { position: true } });
      const moving = await tx.material.findMany({ where: { moduleId: id }, orderBy: { position: "asc" }, select: { id: true } });
      for (const [i, m] of moving.entries()) {
        await tx.material.update({ where: { id: m.id }, data: { moduleId: null, position: (last._max.position ?? -1) + 1 + i } });
      }
      await tx.courseModule.delete({ where: { id } });
    });
  }

  orderModules(iid: string, courseId: string, moduleIds: string[], auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await assertCanManageCourse(tx, auth, courseId);
      const existing = await tx.courseModule.findMany({ where: { courseId }, select: { id: true } });
      const ids = new Set(existing.map((m) => m.id));
      if (ids.size !== moduleIds.length || !moduleIds.every((m) => ids.has(m))) {
        throw new BadRequestException("List every module of the course exactly once");
      }
      for (const [position, id] of moduleIds.entries()) await tx.courseModule.update({ where: { id }, data: { position } });
      return this.outline(tx, courseId, {});
    });
  }

  // ── helpers ──

  private async outline(tx: Tx, courseId: string, where: Prisma.MaterialWhereInput, forStudent = false) {
    const modules = await tx.courseModule.findMany({ where: { courseId }, orderBy: { position: "asc" }, select: { id: true, title: true, position: true } });
    const materials = await tx.material.findMany({ where: { courseId, ...where }, orderBy: { position: "asc" }, select: MATERIAL_FIELDS });
    const views = materials.map((m) => view(m, forStudent));
    return {
      modules: modules
        .map((mod) => ({ ...mod, materials: views.filter((m) => m.moduleId === mod.id) }))
        .filter((mod) => !forStudent || mod.materials.length > 0), // students don't see empty modules
      ungrouped: views.filter((m) => m.moduleId === null),
    };
  }

  private async find(tx: Tx, id: string): Promise<Material> {
    const m = await tx.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    return m;
  }

  private async moduleOf(tx: Tx, moduleId: string, courseId: string) {
    const mod = await tx.courseModule.findUnique({ where: { id: moduleId } });
    if (!mod || mod.courseId !== courseId) throw new BadRequestException("That module isn't part of this course");
    return mod;
  }

  private async link(m: Material, inline: boolean) {
    if (m.externalUrl) return { type: m.type, url: m.externalUrl, external: true };
    if (!m.storageKey) throw new NotFoundException();
    const ttl = 5 * 60;
    const url = await this.storage.presignDownload(m.storageKey, { fileName: m.fileName ?? m.title, inline, ttlSeconds: ttl });
    return { type: m.type, url, external: false, fileName: m.fileName, expiresAt: new Date(Date.now() + ttl * 1000) };
  }
}

/** Throws when `adding` more bytes would exceed the plan's storage allowance. */
export async function assertStorageQuota(tx: Tx, adding: number) {
  const sub = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" }, include: { plan: true } });
  if (!sub) return;
  const used = Number((await tx.material.aggregate({ _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0n);
  const limit = sub.plan.maxStorageMb * 1024 * 1024;
  if (used + adding > limit) {
    throw new ForbiddenException({
      message: `Your ${sub.plan.name} plan includes ${sub.plan.maxStorageMb} MB of storage and ${Math.round(used / 1024 / 1024)} MB is used. Delete files or upgrade the plan.`,
      code: "STORAGE_LIMIT",
    });
  }
}

export async function storageUsage(tx: Tx) {
  const sub = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" }, include: { plan: true } });
  const used = Number((await tx.material.aggregate({ _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0n);
  return { usedBytes: used, limitBytes: sub ? sub.plan.maxStorageMb * 1024 * 1024 : null };
}
