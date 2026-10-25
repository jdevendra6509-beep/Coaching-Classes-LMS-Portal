import { Injectable, NotFoundException } from "@nestjs/common";
import { type Prisma, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { type Page, skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateTeacherDto, PeopleQuery, UpdateTeacherDto } from "./dto.js";
import { PeopleService, toDate, USER_PUBLIC, userSearch } from "./people.service.js";

const TEACHER_VIEW = {
  id: true,
  employeeCode: true,
  qualification: true,
  joiningDate: true,
  createdAt: true,
  membership: { select: { id: true, isActive: true, user: { select: USER_PUBLIC } } },
  _count: { select: { batches: true } },
} as const;

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  list(instituteId: string, q: PeopleQuery) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const where: Prisma.TeacherWhereInput = {
        membership: this.people.membershipFilter(q, Role.TEACHER),
        ...(q.search && {
          OR: [{ membership: { user: userSearch(q.search) } }, { employeeCode: { contains: q.search, mode: "insensitive" } }],
        }),
      };
      // One connection per transaction: run these one after the other, not in parallel.
      const items = await tx.teacher.findMany({ where, select: TEACHER_VIEW, orderBy: { createdAt: "desc" }, ...skipTake(q) });
      const total = await tx.teacher.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize } satisfies Page<unknown>;
    });
  }

  get(instituteId: string, id: string) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const teacher = await tx.teacher.findUnique({
        where: { id },
        select: {
          ...TEACHER_VIEW,
          batches: { select: { batch: { select: { id: true, name: true, startDate: true, endDate: true, course: { select: { id: true, name: true, code: true } } } } } },
        },
      });
      if (!teacher) throw new NotFoundException();
      return teacher;
    });
  }

  async create(instituteId: string, dto: CreateTeacherDto, auth: AuthContext) {
    const { teacher, mail } = await this.prisma.tenant(instituteId, async (tx) => {
      const { user, membership } = await this.people.addMember(tx, instituteId, dto, Role.TEACHER);
      const teacher = await tx.teacher.create({
        data: {
          instituteId,
          membershipId: membership.id,
          employeeCode: dto.employeeCode,
          qualification: dto.qualification,
          joiningDate: toDate(dto.joiningDate),
        },
        select: TEACHER_VIEW,
      });
      await this.audit.record({ action: "teacher.create", entityType: "Teacher", entityId: teacher.id, instituteId, actorUserId: auth.userId }, tx);
      return { teacher, mail: await this.people.welcome(tx, instituteId, user) };
    });
    await this.people.sendAll([mail]);
    return teacher;
  }

  update(instituteId: string, id: string, dto: UpdateTeacherDto, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const existing = await tx.teacher.findUnique({ where: { id }, include: { membership: true } });
      if (!existing) throw new NotFoundException();
      await this.people.updateUserDetails(tx, existing.membership.userId, dto);
      const teacher = await tx.teacher.update({
        where: { id },
        data: { employeeCode: dto.employeeCode, qualification: dto.qualification, joiningDate: toDate(dto.joiningDate) },
        select: TEACHER_VIEW,
      });
      await this.audit.record({ action: "teacher.update", entityType: "Teacher", entityId: id, instituteId, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return teacher;
    });
  }

  setActive(instituteId: string, id: string, isActive: boolean, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const teacher = await tx.teacher.findUnique({ where: { id } });
      if (!teacher) throw new NotFoundException();
      await this.people.setActive(tx, teacher.membershipId, isActive);
      await this.audit.record({ action: isActive ? "teacher.activate" : "teacher.deactivate", entityType: "Teacher", entityId: id, instituteId, actorUserId: auth.userId }, tx);
      return tx.teacher.findUniqueOrThrow({ where: { id }, select: TEACHER_VIEW });
    });
  }

  async resendInvite(instituteId: string, id: string) {
    const mail = await this.prisma.tenant(instituteId, async (tx) => {
      const teacher = await tx.teacher.findUnique({ where: { id } });
      if (!teacher) throw new NotFoundException();
      return this.people.resendInvite(tx, instituteId, teacher.membershipId);
    });
    await this.people.sendAll([mail]);
  }
}
