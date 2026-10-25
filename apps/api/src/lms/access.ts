import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { EnrollmentStatus } from "@lms/db";
import { actorStudent, actorTeacher, isAdmin } from "../common/actor.js";
import type { AuthContext } from "../common/request.js";
import type { Tx } from "../prisma/prisma.service.js";

/** Admins manage every course's content; teachers manage courses they teach a batch of. */
export async function assertCanManageCourse(tx: Tx, auth: AuthContext, courseId: string): Promise<void> {
  if (!(await tx.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw new NotFoundException("Course not found");
  if (isAdmin(auth)) return;
  const teacher = await actorTeacher(tx, auth);
  const teaches = teacher && (await tx.batchTeacher.count({ where: { teacherId: teacher.id, batch: { courseId } } }));
  if (!teaches) throw new ForbiddenException("You don't teach this course");
}

/** A student may read a course's published content while enrolled, and keeps it after completing. */
export async function assertStudentEnrolled(tx: Tx, auth: AuthContext, courseId: string) {
  const student = await actorStudent(tx, auth);
  const enrolled = await tx.enrollment.count({
    where: { studentId: student.id, courseId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] } },
  });
  // Same answer as a course that doesn't exist, so students can't probe for other courses.
  if (!enrolled) throw new NotFoundException("Course not found");
  return student;
}
