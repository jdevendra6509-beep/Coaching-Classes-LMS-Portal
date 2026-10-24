import { BadRequestException, Body, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { EnrollmentStatus, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { CertificatesService } from "../certificates/certificates.service.js";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import { actorMembership, assertBatchAccess } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { EnrollDto } from "./dto.js";
import { enrollStudent } from "./enroll.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller("enrollments")
export class EnrollmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly certificates: CertificatesService,
  ) {}

  @Post()
  enroll(@InstituteId() iid: string, @Body() dto: EnrollDto, @Auth() auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const enrollment = await enrollStudent(tx, iid, dto.studentId, dto.batchId);
      await this.audit.record({ action: "enrollment.create", entityType: "Enrollment", entityId: enrollment.id, instituteId: iid, actorUserId: auth.userId }, tx);
      return enrollment;
    });
  }

  @Post(":id/drop")
  @HttpCode(200)
  drop(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.transition(iid, id, auth, "drop", EnrollmentStatus.ACTIVE, async (tx) =>
      tx.enrollment.update({ where: { id }, data: { status: EnrollmentStatus.DROPPED } }),
    );
  }

  /**
   * The teacher's sign-off that the student has finished the course. Together with fees being
   * fully paid, this is what releases the certificate (certificates module, later milestone).
   */
  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Post(":id/complete")
  @HttpCode(200)
  async complete(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    const enrollment = await this.transition(iid, id, auth, "complete", EnrollmentStatus.ACTIVE, async (tx, batchId) => {
      await assertBatchAccess(tx, auth, batchId);
      const by = await actorMembership(tx, auth, [Role.TEACHER, Role.INSTITUTE_ADMIN]);
      return tx.enrollment.update({
        where: { id },
        data: { status: EnrollmentStatus.COMPLETED, completedAt: new Date(), completedById: by.id },
      });
    });
    // Issues the certificate straight away when fees are already paid; otherwise the final payment will.
    return { ...enrollment, certificate: await this.certificates.afterTrigger(iid, id, auth.userId) };
  }

  /** Undo a completion marked by mistake. */
  @Post(":id/reopen")
  @HttpCode(200)
  reopen(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.transition(iid, id, auth, "reopen", EnrollmentStatus.COMPLETED, async (tx) => {
      if (await tx.certificate.findFirst({ where: { enrollmentId: id } })) {
        throw new BadRequestException("A certificate has already been issued for this enrollment");
      }
      return tx.enrollment.update({ where: { id }, data: { status: EnrollmentStatus.ACTIVE, completedAt: null, completedById: null } });
    });
  }

  private transition<T>(iid: string, id: string, auth: AuthContext, action: string, from: EnrollmentStatus, apply: (tx: Tx, batchId: string) => Promise<T>) {
    return this.prisma.tenant(iid, async (tx) => {
      const e = await tx.enrollment.findUnique({ where: { id } });
      if (!e) throw new NotFoundException();
      if (e.status !== from) throw new BadRequestException(`Enrollment is ${e.status.toLowerCase()}`);
      const result = await apply(tx, e.batchId);
      await this.audit.record({ action: `enrollment.${action}`, entityType: "Enrollment", entityId: id, instituteId: iid, actorUserId: auth.userId, metadata: { from } }, tx);
      return result;
    });
  }
}
