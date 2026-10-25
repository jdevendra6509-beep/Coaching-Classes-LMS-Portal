import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CoursesQuery, CreateCourseDto, UpdateCourseDto } from "./dto.js";

const COURSE_VIEW = {
  id: true,
  code: true,
  name: true,
  description: true,
  durationWeeks: true,
  fee: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { batches: true, enrollments: true } },
} as const satisfies Prisma.CourseSelect;

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(iid: string, q: CoursesQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const where: Prisma.CourseWhereInput = {
        status: q.status,
        ...(q.search && {
          OR: [{ name: { contains: q.search, mode: "insensitive" } }, { code: { contains: q.search, mode: "insensitive" } }],
        }),
      };
      // One connection per transaction: run these one after the other, not in parallel.
      const items = await tx.course.findMany({ where, select: COURSE_VIEW, orderBy: { name: "asc" }, ...skipTake(q) });
      const total = await tx.course.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(iid: string, id: string) {
    return this.prisma.tenant(iid, async (tx) => {
      const course = await tx.course.findUnique({
        where: { id },
        select: {
          ...COURSE_VIEW,
          batches: {
            orderBy: { startDate: "desc" },
            select: { id: true, name: true, startDate: true, endDate: true, capacity: true, _count: { select: { enrollments: true } } },
          },
        },
      });
      if (!course) throw new NotFoundException();
      return course;
    });
  }

  create(iid: string, dto: CreateCourseDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (await tx.course.findFirst({ where: { code: dto.code } })) throw new ConflictException(`Course code ${dto.code} is already used`);
      const course = await tx.course.create({ data: { ...dto, instituteId: iid }, select: COURSE_VIEW });
      await this.audit.record({ action: "course.create", entityType: "Course", entityId: course.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return course;
    });
  }

  update(iid: string, id: string, dto: UpdateCourseDto, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (dto.code && (await tx.course.findFirst({ where: { code: dto.code, id: { not: id } } }))) {
        throw new ConflictException(`Course code ${dto.code} is already used`);
      }
      const course = await tx.course.update({ where: { id }, data: dto, select: COURSE_VIEW });
      await this.audit.record({ action: "course.update", entityType: "Course", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return course;
    });
  }

  /** Only empty courses can be deleted; anything with batches is archived instead, to keep history. */
  remove(iid: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const course = await tx.course.findUnique({ where: { id }, select: { _count: { select: { batches: true } } } });
      if (!course) throw new NotFoundException();
      if (course._count.batches) throw new ConflictException("This course has batches; archive it instead");
      await tx.course.delete({ where: { id } });
      await this.audit.record({ action: "course.delete", entityType: "Course", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
    });
  }
}
