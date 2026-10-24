import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CourseStatus, EnrollmentStatus, type Prisma } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { actorTeacher, assertBatchAccess, isAdmin } from "../common/actor.js";
import { skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { toDate } from "../people/people.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import type { BatchesQuery, CreateBatchDto, UpdateBatchDto } from "./dto.js";
import { enrollStudent, startOfToday } from "./enroll.js";

const BATCH_VIEW = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  schedule: true,
  capacity: true,
  createdAt: true,
  course: { select: { id: true, code: true, name: true, status: true } },
  teachers: { select: { teacher: { select: { id: true, membership: { select: { user: { select: { name: true, email: true } } } } } } } },
  _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
} as const satisfies Prisma.BatchSelect;

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(iid: string, q: BatchesQuery, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const today = startOfToday();
      const where: Prisma.BatchWhereInput = {
        courseId: q.courseId,
        ...(q.search && { name: { contains: q.search, mode: "insensitive" } }),
        ...(q.when === "current" && { OR: [{ endDate: null }, { endDate: { gte: today } }] }),
        ...(q.when === "ended" && { endDate: { lt: today } }),
        AND: [await this.visibleTo(tx, auth)],
      };
      // One connection per transaction: run these one after the other, not in parallel.
      const items = await tx.batch.findMany({ where, select: BATCH_VIEW, orderBy: { startDate: "desc" }, ...skipTake(q) });
      const total = await tx.batch.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const batch = await tx.batch.findUnique({ where: { id }, select: BATCH_VIEW });
      if (!batch) throw new NotFoundException();
      await assertBatchAccess(tx, auth, id);
      return batch;
    });
  }

  create(iid: string, dto: CreateBatchDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const course = await tx.course.findUnique({ where: { id: dto.courseId } });
      if (!course) throw new NotFoundException("Course not found");
      if (course.status === CourseStatus.ARCHIVED) throw new BadRequestException("This course is archived");
      const dates = this.checkDates(dto.startDate, dto.endDate);
      const batch = await tx.batch.create({
        data: { instituteId: iid, courseId: dto.courseId, name: dto.name, schedule: dto.schedule, capacity: dto.capacity, ...dates },
      });
      if (dto.teacherIds?.length) await this.replaceTeachers(tx, iid, batch.id, dto.teacherIds);
      await this.audit.record({ action: "batch.create", entityType: "Batch", entityId: batch.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return tx.batch.findUniqueOrThrow({ where: { id: batch.id }, select: BATCH_VIEW });
    });
  }

  update(iid: string, id: string, dto: UpdateBatchDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const existing = await tx.batch.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const dates = this.checkDates(dto.startDate ?? existing.startDate.toISOString(), dto.endDate ?? existing.endDate?.toISOString());
      if (dto.capacity) {
        const active = await tx.enrollment.count({ where: { batchId: id, status: EnrollmentStatus.ACTIVE } });
        if (dto.capacity < active) throw new BadRequestException(`Capacity can't be below the ${active} students already enrolled`);
      }
      await tx.batch.update({ where: { id }, data: { name: dto.name, schedule: dto.schedule, capacity: dto.capacity, ...dates } });
      await this.audit.record({ action: "batch.update", entityType: "Batch", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return tx.batch.findUniqueOrThrow({ where: { id }, select: BATCH_VIEW });
    });
  }

  setTeachers(iid: string, id: string, teacherIds: string[], auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (!(await tx.batch.findUnique({ where: { id } }))) throw new NotFoundException();
      await this.replaceTeachers(tx, iid, id, teacherIds);
      await this.audit.record({ action: "batch.set_teachers", entityType: "Batch", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { teacherIds } }, tx);
      return tx.batch.findUniqueOrThrow({ where: { id }, select: BATCH_VIEW });
    });
  }

  remove(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const batch = await tx.batch.findUnique({ where: { id }, select: { _count: { select: { enrollments: true, attendance: true } } } });
      if (!batch) throw new NotFoundException();
      if (batch._count.enrollments || batch._count.attendance) throw new ConflictException("This batch has students or attendance and can't be deleted");
      await tx.batch.delete({ where: { id } });
      await this.audit.record({ action: "batch.delete", entityType: "Batch", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
    });
  }

  /** The batch's students (all enrollment statuses), for admins and its teachers. */
  roster(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (!(await tx.batch.findUnique({ where: { id } }))) throw new NotFoundException();
      await assertBatchAccess(tx, auth, id);
      return tx.enrollment.findMany({
        where: { batchId: id },
        orderBy: [{ status: "asc" }, { enrolledAt: "asc" }],
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          completedAt: true,
          student: { select: { id: true, admissionNo: true, membership: { select: { isActive: true, user: { select: { name: true, email: true, phone: true } } } } } },
        },
      });
    });
  }

  /** All-or-nothing: if any student can't be enrolled, none are. */
  enrollMany(iid: string, id: string, studentIds: string[], auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      for (const studentId of studentIds) await enrollStudent(tx, iid, studentId, id);
      await this.audit.record({ action: "batch.enroll", entityType: "Batch", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { studentIds } }, tx);
      return { enrolled: studentIds.length };
    });
  }

  private async replaceTeachers(tx: Tx, iid: string, batchId: string, teacherIds: string[]) {
    const active = await tx.teacher.count({ where: { id: { in: teacherIds }, membership: { isActive: true } } });
    if (active !== teacherIds.length) throw new BadRequestException("Every teacher must exist and be active");
    await tx.batchTeacher.deleteMany({ where: { batchId } });
    await tx.batchTeacher.createMany({ data: teacherIds.map((teacherId) => ({ instituteId: iid, batchId, teacherId })) });
  }

  private checkDates(start: string, end?: string) {
    const startDate = toDate(start)!;
    const endDate = toDate(end);
    if (endDate && endDate < startDate) throw new BadRequestException("endDate must be on or after startDate");
    return { startDate, endDate };
  }

  private async visibleTo(tx: Tx, auth: AuthContext): Promise<Prisma.BatchWhereInput> {
    if (isAdmin(auth)) return {};
    const teacher = await actorTeacher(tx, auth);
    return teacher ? { teachers: { some: { teacherId: teacher.id } } } : { id: { in: [] } };
  }
}
