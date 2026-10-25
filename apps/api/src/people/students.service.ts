import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { type Prisma, Role } from "@lms/db";
import { enrollStudent } from "../academics/enroll.js";
import { actorTeacher, isAdmin } from "../common/actor.js";
import { AuditService } from "../audit/audit.service.js";
import { parseCsv } from "../common/csv.js";
import { skipTake } from "../common/pagination.js";
import type { AuthContext } from "../common/request.js";
import { nextDocumentNumber } from "../common/sequence.js";
import type { MailMessage } from "../mail/mail.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { CreateStudentDto, type ImportStudentsDto, type StudentsQuery, type UpdateStudentDto } from "./dto.js";
import { PeopleService, toDate, USER_PUBLIC, userSearch } from "./people.service.js";

const MAX_IMPORT_ROWS = 2000;

const STUDENT_VIEW = {
  id: true,
  admissionNo: true,
  dateOfBirth: true,
  guardianName: true,
  guardianPhone: true,
  guardianEmail: true,
  address: true,
  createdAt: true,
  membership: { select: { id: true, isActive: true, user: { select: USER_PUBLIC } } },
  enrollments: {
    orderBy: { enrolledAt: "desc" },
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      completedAt: true,
      course: { select: { id: true, code: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  },
} as const satisfies Prisma.StudentSelect;

/** CSV header (normalised: lower-case, letters and digits only) → DTO field. */
const CSV_COLUMNS: Record<string, string> = {
  name: "name",
  studentname: "name",
  email: "email",
  phone: "phone",
  mobile: "phone",
  admissionno: "admissionNo",
  admissionnumber: "admissionNo",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  guardianname: "guardianName",
  parentname: "guardianName",
  guardianphone: "guardianPhone",
  parentphone: "guardianPhone",
  guardianemail: "guardianEmail",
  parentemail: "guardianEmail",
  address: "address",
  batch: "batch",
};

export interface ImportError {
  row: number; // 1-based line number in the file, header = 1
  field?: string;
  message: string;
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  list(instituteId: string, q: StudentsQuery, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const where: Prisma.StudentWhereInput = {
        membership: this.people.membershipFilter(q, Role.STUDENT),
        ...(q.search && {
          OR: [{ membership: { user: userSearch(q.search) } }, { admissionNo: { contains: q.search, mode: "insensitive" } }],
        }),
        AND: [
          ...(q.batchId ? [{ enrollments: { some: { batchId: q.batchId } } }] : []),
          ...(q.courseId ? [{ enrollments: { some: { courseId: q.courseId } } }] : []),
          await this.visibleTo(tx, auth),
        ],
      };
      // One connection per transaction: run these one after the other, not in parallel.
      const items = await tx.student.findMany({ where, select: STUDENT_VIEW, orderBy: { createdAt: "desc" }, ...skipTake(q) });
      const total = await tx.student.count({ where });
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(instituteId: string, id: string, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id, AND: [await this.visibleTo(tx, auth)] }, select: STUDENT_VIEW });
      if (!student) throw new NotFoundException();
      return student;
    });
  }

  async create(instituteId: string, dto: CreateStudentDto, auth: AuthContext) {
    const { student, mail } = await this.prisma.tenant(instituteId, async (tx) => {
      await this.people.assertStudentCapacity(tx, 1);
      const { student, mail } = await this.createOne(tx, instituteId, dto);
      if (dto.batchId) await enrollStudent(tx, instituteId, student.id, dto.batchId);
      await this.audit.record({ action: "student.create", entityType: "Student", entityId: student.id, instituteId, actorUserId: auth.userId }, tx);
      return { student: await tx.student.findUniqueOrThrow({ where: { id: student.id }, select: STUDENT_VIEW }), mail };
    });
    await this.people.sendAll([mail]);
    return student;
  }

  update(instituteId: string, id: string, dto: UpdateStudentDto, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const existing = await tx.student.findUnique({ where: { id }, include: { membership: true } });
      if (!existing) throw new NotFoundException();
      const { name, phone, dateOfBirth, ...profile } = dto;
      await this.people.updateUserDetails(tx, existing.membership.userId, { name, phone });
      await tx.student.update({ where: { id }, data: { ...profile, dateOfBirth: toDate(dateOfBirth) } });
      await this.audit.record({ action: "student.update", entityType: "Student", entityId: id, instituteId, actorUserId: auth.userId, metadata: { ...dto } }, tx);
      return tx.student.findUniqueOrThrow({ where: { id }, select: STUDENT_VIEW });
    });
  }

  setActive(instituteId: string, id: string, isActive: boolean, auth: AuthContext) {
    return this.prisma.tenant(instituteId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id }, include: { membership: true } });
      if (!student) throw new NotFoundException();
      if (isActive && !student.membership.isActive) await this.people.assertStudentCapacity(tx, 1);
      await this.people.setActive(tx, student.membershipId, isActive);
      await this.audit.record({ action: isActive ? "student.activate" : "student.deactivate", entityType: "Student", entityId: id, instituteId, actorUserId: auth.userId }, tx);
      return tx.student.findUniqueOrThrow({ where: { id }, select: STUDENT_VIEW });
    });
  }

  async resendInvite(instituteId: string, id: string) {
    const mail = await this.prisma.tenant(instituteId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id } });
      if (!student) throw new NotFoundException();
      return this.people.resendInvite(tx, instituteId, student.membershipId);
    });
    await this.people.sendAll([mail]);
  }

  /**
   * All-or-nothing CSV import. Every row is validated first (fields, duplicates within the file
   * and against existing students, batch names, plan limit); if anything is wrong nothing is
   * written and every problem is reported with its line number.
   */
  async import(instituteId: string, dto: ImportStudentsDto, auth: AuthContext) {
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(dto.csv);
    } catch (err) {
      throw new BadRequestException(`Could not read the CSV: ${(err as Error).message}`);
    }
    const columns = parsed.headers.map((h) => CSV_COLUMNS[h.replace(/[^a-z0-9]/g, "")]);
    if (!columns.includes("name") || !columns.includes("email")) {
      throw new BadRequestException("The CSV needs a header row with at least 'name' and 'email' columns");
    }
    if (!parsed.rows.length) throw new BadRequestException("The CSV has no data rows");
    if (parsed.rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} students at a time`);

    const records = parsed.rows.map((raw) => {
      const rec: Record<string, string> = {};
      parsed.headers.forEach((h, i) => {
        if (columns[i]) rec[columns[i]] = raw[h];
      });
      return rec;
    });

    const result = await this.prisma.tenant(
      instituteId,
      async (tx) => {
        const errors: ImportError[] = [];
        const dtos: { line: number; dto: CreateStudentDto; batchId?: string }[] = [];

        const batches = await tx.batch.findMany({ select: { id: true, name: true } });
        const batchByName = new Map<string, string[]>();
        for (const b of batches) batchByName.set(b.name.toLowerCase(), [...(batchByName.get(b.name.toLowerCase()) ?? []), b.id]);

        const seenEmails = new Map<string, number>();
        const seenAdmissions = new Map<string, number>();
        for (const [i, { batch, ...fields }] of records.entries()) {
          const line = i + 2;
          const row = plainToInstance(CreateStudentDto, fields);
          for (const e of await validate(row, { whitelist: true, forbidUnknownValues: false })) {
            errors.push({ row: line, field: e.property, message: Object.values(e.constraints ?? {})[0] ?? "invalid" });
          }
          if (row.email) {
            if (seenEmails.has(row.email)) errors.push({ row: line, field: "email", message: `duplicate of line ${seenEmails.get(row.email)}` });
            else seenEmails.set(row.email, line);
          }
          if (row.admissionNo) {
            if (seenAdmissions.has(row.admissionNo)) errors.push({ row: line, field: "admissionNo", message: `duplicate of line ${seenAdmissions.get(row.admissionNo)}` });
            else seenAdmissions.set(row.admissionNo, line);
          }
          let batchId: string | undefined;
          if (batch) {
            const ids = batchByName.get(batch.toLowerCase()) ?? [];
            if (ids.length === 1) batchId = ids[0];
            else errors.push({ row: line, field: "batch", message: ids.length ? `more than one batch is named "${batch}"` : `no batch named "${batch}"` });
          }
          dtos.push({ line, dto: row, batchId });
        }

        const already = await tx.membership.findMany({
          where: { role: Role.STUDENT, user: { email: { in: [...seenEmails.keys()] } } },
          select: { user: { select: { email: true } } },
        });
        for (const { user } of already) errors.push({ row: seenEmails.get(user.email)!, field: "email", message: "already a student here" });
        const taken = await tx.student.findMany({ where: { admissionNo: { in: [...seenAdmissions.keys()] } }, select: { admissionNo: true } });
        for (const { admissionNo } of taken) errors.push({ row: seenAdmissions.get(admissionNo)!, field: "admissionNo", message: "already used by another student" });

        if (!errors.length) {
          try {
            await this.people.assertStudentCapacity(tx, dtos.length);
          } catch (err) {
            errors.push({ row: 0, message: (err as { message: string }).message });
          }
        }

        errors.sort((a, b) => a.row - b.row);
        if (errors.length || dto.dryRun) return { rows: dtos.length, imported: 0, errors, mail: [] as MailMessage[] };

        const mail: MailMessage[] = [];
        for (const { dto: row, batchId } of dtos) {
          const created = await this.createOne(tx, instituteId, row);
          if (batchId) await enrollStudent(tx, instituteId, created.student.id, batchId);
          mail.push(created.mail);
        }
        await this.audit.record({ action: "student.import", entityType: "Student", instituteId, actorUserId: auth.userId, metadata: { count: dtos.length } }, tx);
        return { rows: dtos.length, imported: dtos.length, errors, mail };
      },
      { timeout: 120_000 },
    );

    if (result.imported && dto.sendInvites !== false) {
      // TODO(worker): hand this to the email queue. Until then, send in the background so a large
      // import responds quickly; anything that fails can be re-sent per student.
      void this.people.sendAll(result.mail).catch((err) => this.logger.error(err));
    }
    return { rows: result.rows, imported: result.imported, valid: result.errors.length === 0, errors: result.errors };
  }

  private async createOne(tx: Tx, instituteId: string, dto: CreateStudentDto) {
    const { user, membership } = await this.people.addMember(tx, instituteId, dto, Role.STUDENT);
    const student = await tx.student.create({
      data: {
        instituteId,
        membershipId: membership.id,
        admissionNo: dto.admissionNo ?? (await nextDocumentNumber(tx, instituteId, "ADMISSION")),
        dateOfBirth: toDate(dto.dateOfBirth),
        guardianName: dto.guardianName,
        guardianPhone: dto.guardianPhone,
        guardianEmail: dto.guardianEmail,
        address: dto.address,
      },
    });
    return { student, mail: await this.people.welcome(tx, instituteId, user) };
  }

  /** Admins and accountants see every student; teachers only those in their batches. */
  private async visibleTo(tx: Tx, auth: AuthContext): Promise<Prisma.StudentWhereInput> {
    if (isAdmin(auth) || auth.roles.includes(Role.ACCOUNTANT)) return {};
    const teacher = await actorTeacher(tx, auth);
    if (!teacher) return { id: { in: [] } };
    return { enrollments: { some: { batch: { teachers: { some: { teacherId: teacher.id } } } } } };
  }
}
