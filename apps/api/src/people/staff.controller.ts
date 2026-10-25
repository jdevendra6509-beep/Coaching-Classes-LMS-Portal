import { BadRequestException, Body, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateStaffDto } from "./dto.js";
import { PeopleService } from "./people.service.js";

const STAFF_ROLES: Role[] = [Role.INSTITUTE_ADMIN, Role.ACCOUNTANT];

/** Additional admins and accountants. Listing is GET /institute/members. */
@Roles(Role.INSTITUTE_ADMIN)
@Controller("staff")
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@InstituteId() iid: string, @Body() dto: CreateStaffDto, @Auth() auth: AuthContext) {
    const { membership, mail } = await this.prisma.tenant(iid, async (tx) => {
      const { user, membership } = await this.people.addMember(tx, iid, dto, dto.role);
      await this.audit.record({ action: "staff.create", entityType: "Membership", entityId: membership.id, instituteId: iid, actorUserId: auth.userId, metadata: { role: dto.role } }, tx);
      return { membership, mail: await this.people.welcome(tx, iid, user) };
    });
    await this.people.sendAll([mail]);
    return { id: membership.id, role: membership.role, isActive: membership.isActive };
  }

  @Post(":membershipId/deactivate")
  @HttpCode(200)
  deactivate(@InstituteId() iid: string, @Param("membershipId", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id } });
      if (!m || !STAFF_ROLES.includes(m.role)) throw new NotFoundException();
      if (m.userId === auth.userId) throw new BadRequestException("You can't deactivate yourself");
      if (m.role === Role.INSTITUTE_ADMIN) {
        const admins = await tx.membership.count({ where: { role: Role.INSTITUTE_ADMIN, isActive: true } });
        if (admins <= 1) throw new BadRequestException("An institute needs at least one active admin");
      }
      const updated = await this.people.setActive(tx, id, false);
      await this.audit.record({ action: "staff.deactivate", entityType: "Membership", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
      return { id: updated.id, role: updated.role, isActive: updated.isActive };
    });
  }

  @Post(":membershipId/activate")
  @HttpCode(200)
  activate(@InstituteId() iid: string, @Param("membershipId", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id } });
      if (!m || !STAFF_ROLES.includes(m.role)) throw new NotFoundException();
      const updated = await this.people.setActive(tx, id, true);
      await this.audit.record({ action: "staff.activate", entityType: "Membership", entityId: id, instituteId: iid, actorUserId: auth.userId }, tx);
      return { id: updated.id, role: updated.role, isActive: updated.isActive };
    });
  }
}
