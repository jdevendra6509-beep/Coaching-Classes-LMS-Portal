import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AttendanceStatus, EnrollmentStatus, Role } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { actorMembership, actorTeacher, assertBatchAccess, isAdmin } from "../common/actor.js";
import { isoDate } from "../common/date.pipe.js";
import type { AuthContext } from "../common/request.js";
import { toDate } from "../people/people.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import type { AttendanceRecordDto, DateRangeQuery } from "./dto.js";
import { startOfToday } from "./enroll.js";

export interface AttendanceSummary {
  batchId: string;
  batchName: string;
  courseName: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** (present + late) / (total − excused), rounded to one decimal; null with no sessions. */
  percentage: number | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The register for one day: every actively enrolled student with their mark (null if not
   * yet marked). This is what the teacher's attendance screen loads.
   */
  register(iid: string, batchId: string, date: Date, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await this.batchFor(tx, auth, batchId);
      const session = await tx.attendanceSession.findUnique({
        where: { batchId_date: { batchId, date } },
        include: { records: true, takenBy: { select: { user: { select: { name: true } } } } },
      });
      const enrolled = await tx.enrollment.findMany({
        where: { batchId, status: EnrollmentStatus.ACTIVE },
        orderBy: { student: { admissionNo: "asc" } },
        select: { student: { select: { id: true, admissionNo: true, membership: { select: { user: { select: { name: true } } } } } } },
      });
      const marks = new Map(session?.records.map((r) => [r.studentId, r]) ?? []);
      return {
        date: isoDate(date),
        takenBy: session?.takenBy.user.name ?? null,
        takenAt: session?.createdAt ?? null,
        students: enrolled.map(({ student }) => ({
          studentId: student.id,
          admissionNo: student.admissionNo,
          name: student.membership.user.name,
          status: marks.get(student.id)?.status ?? null,
          remark: marks.get(student.id)?.remark ?? null,
        })),
      };
    });
  }

  /** Saves the day's register, replacing any earlier marks for that day. */
  mark(iid: string, batchId: string, date: Date, records: AttendanceRecordDto[], auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      const batch = await this.batchFor(tx, auth, batchId);
      if (date > startOfToday()) throw new BadRequestException("Attendance can't be marked for a future date");
      if (date < batch.startDate || (batch.endDate && date > batch.endDate)) {
        throw new BadRequestException("That date is outside the batch's start and end dates");
      }
      const ids = records.map((r) => r.studentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException("Each student can appear only once");
      const enrolled = await tx.enrollment.count({ where: { batchId, status: EnrollmentStatus.ACTIVE, studentId: { in: ids } } });
      if (enrolled !== ids.length) throw new BadRequestException("Every student must be actively enrolled in this batch");

      const by = await actorMembership(tx, auth, [Role.TEACHER, Role.INSTITUTE_ADMIN]);
      const session = await tx.attendanceSession.upsert({
        where: { batchId_date: { batchId, date } },
        create: { instituteId: iid, batchId, date, takenById: by.id },
        update: { takenById: by.id },
      });
      await tx.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
      await tx.attendanceRecord.createMany({
        data: records.map((r) => ({ instituteId: iid, sessionId: session.id, studentId: r.studentId, status: r.status, remark: r.remark })),
      });
      await this.audit.record({ action: "attendance.mark", entityType: "AttendanceSession", entityId: session.id, instituteId: iid, actorUserId: auth.userId, metadata: { date: isoDate(date), count: records.length } }, tx);
      return { sessionId: session.id, date: isoDate(date), marked: records.length };
    });
  }

  /** Sessions in a date range (default: last 31 days) with every mark. */
  history(iid: string, batchId: string, q: DateRangeQuery, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      await this.batchFor(tx, auth, batchId);
      const to = toDate(q.to) ?? startOfToday();
      const from = toDate(q.from) ?? new Date(to.getTime() - 30 * 86_400_000);
      const sessions = await tx.attendanceSession.findMany({
        where: { batchId, date: { gte: from, lte: to } },
        orderBy: { date: "desc" },
        select: { id: true, date: true, records: { select: { studentId: true, status: true, remark: true } } },
      });
      return sessions.map((s) => ({ ...s, date: isoDate(s.date) }));
    });
  }

  /** Per-batch totals for one student. Teachers only see their own batches. */
  studentSummary(iid: string, studentId: string, q: DateRangeQuery & { batchId?: string }, auth: AuthContext) {
    return this.prisma.tenant(iid, async (tx) => {
      if (!(await tx.student.findUnique({ where: { id: studentId } }))) throw new NotFoundException();
      let batchFilter: string[] | undefined;
      if (!isAdmin(auth) && !auth.roles.includes(Role.ACCOUNTANT)) {
        const teacher = await actorTeacher(tx, auth);
        const own = teacher ? await tx.batchTeacher.findMany({ where: { teacherId: teacher.id }, select: { batchId: true } }) : [];
        batchFilter = own.map((b) => b.batchId);
      }
      return summarise(tx, studentId, q, batchFilter);
    });
  }

  private async batchFor(tx: Tx, auth: AuthContext, batchId: string) {
    const batch = await tx.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("Batch not found");
    await assertBatchAccess(tx, auth, batchId);
    return batch;
  }
}

export async function summarise(tx: Tx, studentId: string, q: DateRangeQuery & { batchId?: string }, onlyBatches?: string[]): Promise<AttendanceSummary[]> {
  const enrollments = await tx.enrollment.findMany({
    where: {
      studentId,
      ...(q.batchId && { batchId: q.batchId }),
      ...(onlyBatches && { batchId: { in: q.batchId ? onlyBatches.filter((b) => b === q.batchId) : onlyBatches } }),
    },
    select: { batch: { select: { id: true, name: true, course: { select: { name: true } } } } },
  });
  const batchIds = enrollments.map((e) => e.batch.id);
  const from = toDate(q.from) ?? null;
  const to = toDate(q.to) ?? null;
  const rows = batchIds.length
    ? await tx.$queryRaw<{ batchId: string; status: AttendanceStatus; n: number }[]>`
        SELECT s."batchId", r.status, count(*)::int AS n
        FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
        WHERE r."studentId" = ${studentId}::uuid
          AND s."batchId" = ANY(${batchIds}::uuid[])
          AND (${from}::date IS NULL OR s.date >= ${from}::date)
          AND (${to}::date IS NULL OR s.date <= ${to}::date)
        GROUP BY 1, 2`
    : [];
  return enrollments.map(({ batch }) => {
    const n = (status: AttendanceStatus) => rows.find((r) => r.batchId === batch.id && r.status === status)?.n ?? 0;
    const present = n(AttendanceStatus.PRESENT);
    const absent = n(AttendanceStatus.ABSENT);
    const late = n(AttendanceStatus.LATE);
    const excused = n(AttendanceStatus.EXCUSED);
    const counted = present + absent + late;
    return {
      batchId: batch.id,
      batchName: batch.name,
      courseName: batch.course.name,
      total: counted + excused,
      present,
      absent,
      late,
      excused,
      percentage: counted > 0 ? Math.round(((present + late) / counted) * 1000) / 10 : null,
    };
  });
}
