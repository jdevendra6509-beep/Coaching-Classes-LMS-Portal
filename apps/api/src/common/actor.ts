import { ForbiddenException } from "@nestjs/common";
import { Role } from "@lms/db";
import type { Tx } from "../prisma/prisma.service.js";
import type { AuthContext } from "./request.js";

export const isAdmin = (auth: AuthContext) => auth.roles.includes(Role.INSTITUTE_ADMIN);

/** The caller's membership row for one of the given roles (first match), inside the tenant transaction. */
export async function actorMembership(tx: Tx, auth: AuthContext, roles: Role[]) {
  const m = await tx.membership.findFirst({
    where: { userId: auth.userId, role: { in: roles }, isActive: true },
    orderBy: { role: "asc" },
  });
  if (!m) throw new ForbiddenException();
  return m;
}

/** The caller's Teacher profile, or null if they aren't a teacher here. */
export function actorTeacher(tx: Tx, auth: AuthContext) {
  if (!auth.roles.includes(Role.TEACHER)) return Promise.resolve(null);
  return tx.teacher.findFirst({ where: { membership: { userId: auth.userId, role: Role.TEACHER, isActive: true } } });
}

/** The caller's Student profile; throws if they aren't a student here. */
export async function actorStudent(tx: Tx, auth: AuthContext) {
  const s = await tx.student.findFirst({ where: { membership: { userId: auth.userId, role: Role.STUDENT, isActive: true } } });
  if (!s) throw new ForbiddenException();
  return s;
}

/**
 * Admins may act on any batch. Teachers only on batches they're assigned to.
 * Anything else is refused with 403.
 */
export async function assertBatchAccess(tx: Tx, auth: AuthContext, batchId: string): Promise<void> {
  if (isAdmin(auth)) return;
  const teacher = await actorTeacher(tx, auth);
  const assigned = teacher && (await tx.batchTeacher.count({ where: { batchId, teacherId: teacher.id } }));
  if (!assigned) throw new ForbiddenException("You are not assigned to this batch");
}
