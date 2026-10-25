import { Controller, Get, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { summarise } from "../academics/attendance.service.js";
import { DateRangeQuery } from "../academics/dto.js";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import { actorStudent } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** A student's own data. The student is always derived from the session, never from a parameter. */
@Roles(Role.STUDENT)
@Controller("me")
export class PortalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("profile")
  profile(@InstituteId() iid: string, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const { id } = await actorStudent(tx, auth);
      return tx.student.findUniqueOrThrow({
        where: { id },
        select: {
          id: true, admissionNo: true, dateOfBirth: true, guardianName: true, guardianPhone: true, guardianEmail: true, address: true,
          membership: { select: { user: { select: { name: true, email: true, phone: true } } } },
        },
      });
    });
  }

  @Get("enrollments")
  enrollments(@InstituteId() iid: string, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const { id } = await actorStudent(tx, auth);
      return tx.enrollment.findMany({
        where: { studentId: id, status: { not: "DROPPED" } },
        orderBy: { enrolledAt: "desc" },
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          completedAt: true,
          course: { select: { id: true, code: true, name: true, description: true, durationWeeks: true } },
          batch: {
            select: {
              id: true, name: true, startDate: true, endDate: true, schedule: true,
              teachers: { select: { teacher: { select: { membership: { select: { user: { select: { name: true } } } } } } } },
            },
          },
        },
      });
    });
  }

  @Get("attendance")
  attendance(@InstituteId() iid: string, @Auth() auth: AuthContext, @Query() q: DateRangeQuery) {
    return this.prisma.tenant(iid, async (tx) => {
      const { id } = await actorStudent(tx, auth);
      return summarise(tx, id, q);
    });
  }
}
