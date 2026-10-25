import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CourseStatus, EnrollmentStatus } from "@lms/db";
import type { Tx } from "../prisma/prisma.service.js";

/**
 * Enrolls a student in a batch (and therefore its course). Enforces: the course isn't archived,
 * the batch hasn't ended, capacity, and one enrollment per student per batch. A dropped
 * enrollment is reactivated rather than duplicated.
 */
export async function enrollStudent(tx: Tx, instituteId: string, studentId: string, batchId: string) {
  // Lock the batch row so concurrent enrollments can't overshoot its capacity.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE id = ${batchId}::uuid FOR UPDATE`;
  if (!locked.length) throw new NotFoundException("Batch not found");
  const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { course: true } });
  const student = await tx.student.findUnique({ where: { id: studentId }, include: { membership: true } });
  if (!student) throw new NotFoundException("Student not found");
  if (!student.membership.isActive) throw new BadRequestException("Student is inactive");
  if (batch.course.status === CourseStatus.ARCHIVED) throw new BadRequestException("This course is archived");
  if (batch.endDate && batch.endDate < startOfToday()) throw new BadRequestException("This batch has already ended");

  const existing = await tx.enrollment.findUnique({ where: { studentId_batchId: { studentId, batchId } } });
  if (existing && existing.status !== EnrollmentStatus.DROPPED) throw new ConflictException("Student is already enrolled in this batch");

  if (batch.capacity) {
    const active = await tx.enrollment.count({ where: { batchId, status: EnrollmentStatus.ACTIVE } });
    if (active >= batch.capacity) throw new ConflictException(`Batch is full (${batch.capacity} students)`);
  }

  if (existing) {
    return tx.enrollment.update({ where: { id: existing.id }, data: { status: EnrollmentStatus.ACTIVE, enrolledAt: new Date() } });
  }
  return tx.enrollment.create({ data: { instituteId, studentId, batchId, courseId: batch.courseId } });
}

export function startOfToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
