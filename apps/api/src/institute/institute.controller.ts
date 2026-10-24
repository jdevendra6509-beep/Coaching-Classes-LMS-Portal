import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Role } from "@lms/db";
import type { AuthContext } from "../common/request.js";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UpdateInstituteDto } from "./dto.js";

const PROFILE = {
  id: true, slug: true, name: true, legalName: true, email: true, phone: true, gstin: true,
  address: true, city: true, state: true, pincode: true, logoKey: true, status: true,
} as const;

/** The signed-in user's own institute. Everything here runs through prisma.tenant(), i.e. under RLS. */
@Controller("institute")
export class InstituteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.STUDENT)
  @Get()
  profile(@InstituteId() instituteId: string) {
    return this.prisma.tenant(instituteId, (tx) => tx.institute.findUniqueOrThrow({ where: { id: instituteId }, select: PROFILE }));
  }

  @Roles(Role.INSTITUTE_ADMIN)
  @Patch()
  update(@InstituteId() instituteId: string, @Body() dto: UpdateInstituteDto, @Auth() auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const updated = await tx.institute.update({ where: { id: instituteId }, data: dto, select: PROFILE });
      await this.audit.record(
        { action: "institute.update", entityType: "Institute", entityId: instituteId, instituteId, actorUserId: auth.userId, metadata: { ...dto } },
        tx,
      );
      return updated;
    });
  }

  @Roles(Role.INSTITUTE_ADMIN)
  @Get("members")
  members(@InstituteId() instituteId: string) {
    return this.prisma.tenant(instituteId, (tx) =>
      tx.membership.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          isActive: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
        },
      }),
    );
  }
}
