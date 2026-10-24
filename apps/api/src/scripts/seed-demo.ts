// Local demo data, built through the real services so every rule (ledger postings, numbering,
// RLS) applies. Usage, with the API's env loaded:  node dist/scripts/seed-demo.js
// Never run against production: it creates known passwords.
import "../config/load-env.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { InstituteStatus, Role, UserStatus } from "@lms/db";
import { AttendanceService } from "../academics/attendance.service.js";
import { BatchesService } from "../academics/batches.service.js";
import { CoursesService } from "../academics/courses.service.js";
import { AppModule } from "../app.module.js";
import { hashPassword } from "../auth/password.js";
import type { AuthContext } from "../common/request.js";
import { env, instituteUrl } from "../config/env.js";
import { InvoicesService } from "../finance/invoices.service.js";
import { PayablesService } from "../finance/payables.service.js";
import { StaffController } from "../people/staff.controller.js";
import { StudentsService } from "../people/students.service.js";
import { TeachersService } from "../people/teachers.service.js";
import { ProvisioningService } from "../platform/provisioning.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const PASSWORD = "demo-password-123";
const SLUG = "demo";

if (env().NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
const prisma = app.get(PrismaService);
const db = prisma.platform;

if (await db.institute.findUnique({ where: { slug: SLUG } })) {
  console.log(`Institute "${SLUG}" already exists; nothing to do.`);
  await app.close();
  process.exit(0);
}

const passwordHash = await hashPassword(PASSWORD);
const activate = (email: string) => db.user.update({ where: { email }, data: { passwordHash, status: UserStatus.ACTIVE } });
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

await db.user.upsert({
  where: { email: "platform@demo.test" },
  create: { email: "platform@demo.test", name: "Platform Admin", passwordHash, status: UserStatus.ACTIVE, isPlatformAdmin: true },
  update: {},
});
const plan = await db.plan.upsert({
  where: { code: "starter" },
  create: { code: "starter", name: "Starter", pricePerMonth: 1999, maxStudents: 300, maxStorageMb: 10240, razorpayPlanId: "plan_demo_starter" },
  update: {},
});
await db.plan.upsert({
  where: { code: "growth" },
  create: { code: "growth", name: "Growth", pricePerMonth: 4999, maxStudents: 1500, maxStorageMb: 51200, razorpayPlanId: "plan_demo_growth" },
  update: {},
});

const inst = await db.institute.create({
  data: { slug: SLUG, name: "Bright Future Academy", email: "office@demo.test", phone: "9876543210", city: "Pune", state: "Maharashtra", address: "2nd floor, FC Road", status: InstituteStatus.ACTIVE },
});
await db.subscription.create({ data: { instituteId: inst.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
await db.$transaction((tx) => app.get(ProvisioningService).seedInstitute(tx, inst.id));

const owner = await db.user.create({ data: { email: "admin@demo.test", name: "Anita Deshpande", passwordHash, status: UserStatus.ACTIVE } });
await db.membership.create({ data: { instituteId: inst.id, userId: owner.id, role: Role.INSTITUTE_ADMIN } });
const admin: AuthContext = { userId: owner.id, sessionId: "seed", isPlatformAdmin: false, instituteId: inst.id, slug: SLUG, roles: [Role.INSTITUTE_ADMIN] };

await app.get(StaffController).create(inst.id, { name: "Rahul Kulkarni", email: "accounts@demo.test", role: Role.ACCOUNTANT }, admin);
const t1 = await app.get(TeachersService).create(inst.id, { name: "Meera Iyer", email: "meera@demo.test", employeeCode: "T-01", qualification: "M.Sc. Physics" }, admin);
const t2 = await app.get(TeachersService).create(inst.id, { name: "Prakash Rao", email: "prakash@demo.test", employeeCode: "T-02", qualification: "M.Sc. Mathematics" }, admin);

const courses = app.get(CoursesService);
const jee = await courses.create(inst.id, { code: "JEE27", name: "JEE Main & Advanced 2027", fee: 85000, durationWeeks: 48, status: "PUBLISHED" }, admin);
const neet = await courses.create(inst.id, { code: "NEET27", name: "NEET 2027", fee: 72000, durationWeeks: 44, status: "PUBLISHED" }, admin);
const found = await courses.create(inst.id, { code: "FDN10", name: "Class 10 Foundation", fee: 24000, durationWeeks: 30, status: "PUBLISHED" }, admin);

const batches = app.get(BatchesService);
const jeeA = await batches.create(inst.id, { courseId: jee.id, name: "JEE Morning A", startDate: days(-60), schedule: "Mon–Sat 7–10 am", capacity: 40, teacherIds: [t1.id, t2.id] }, admin);
const neetA = await batches.create(inst.id, { courseId: neet.id, name: "NEET Evening", startDate: days(-45), schedule: "Mon–Fri 5–8 pm", capacity: 40, teacherIds: [t1.id] }, admin);
await batches.create(inst.id, { courseId: found.id, name: "Foundation Weekend", startDate: days(-20), schedule: "Sat–Sun 9 am–1 pm", teacherIds: [t2.id] }, admin);

const students = app.get(StudentsService);
const roster = [
  ["Aarav Shah", "aarav@demo.test", jeeA.id],
  ["Diya Patil", "diya@demo.test", jeeA.id],
  ["Kabir Menon", "kabir@demo.test", jeeA.id],
  ["Riya Sen", "riya@demo.test", neetA.id],
  ["Ishaan Joshi", "ishaan@demo.test", neetA.id],
  ["Saanvi Nair", "saanvi@demo.test", neetA.id],
] as const;
const created = [];
for (const [name, email, batchId] of roster) {
  created.push(await students.create(inst.id, { name, email, phone: "98" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"), guardianName: `Parent of ${name.split(" ")[0]}`, guardianEmail: `parent.${email}`, batchId }, admin));
}

// Fees: one paid in full, some part-paid, one in instalments with an overdue part.
const invoices = app.get(InvoicesService);
for (const [i, s] of created.entries()) {
  const inv = await invoices.fromEnrollment(
    inst.id,
    {
      enrollmentId: s.enrollments[0].id,
      taxRate: 0,
      issue: true,
      issueDate: days(-40),
      ...(i === 2 && { installments: [{ dueDate: days(-10), amount: 42500 }, { dueDate: days(50), amount: 42500 }] }),
      ...(i === 1 && { discounts: [{ amount: 5000, description: "Merit scholarship" }] }),
    },
    admin,
  );
  const pay = [Number(inv.total), 30000, 20000, 72000, 0, 36000][i];
  if (pay) await invoices.recordPayment(inst.id, inv.id, { amount: pay, method: i % 2 ? "UPI" : "CASH", sendReceipt: false }, admin);
}

// A month of rent, paid.
const payables = app.get(PayablesService);
const rentAccount = await prisma.tenant(inst.id, (tx) => tx.account.findFirstOrThrow({ where: { code: "5100" } }));
const landlord = await payables.createVendor(inst.id, { name: "Sai Properties" }, admin);
const bill = await payables.createBill(inst.id, { vendorId: landlord.id, billNumber: "SP/2026/10", billDate: days(-20), dueDate: days(-5), expenseAccountId: rentAccount.id, total: 45000 }, admin);
await payables.payBill(inst.id, bill.id, { amount: 45000, method: "BANK_TRANSFER", reference: "NEFT 8812" }, admin);

// Two weeks of attendance for the JEE batch.
const attendance = app.get(AttendanceService);
const jeeStudents = created.slice(0, 3);
const teacherCtx: AuthContext = { ...admin, roles: [Role.INSTITUTE_ADMIN] };
for (let d = 14; d >= 1; d--) {
  const date = new Date(`${days(-d)}T00:00:00Z`);
  if (date.getUTCDay() === 0) continue; // Sundays off
  await attendance.mark(
    inst.id,
    jeeA.id,
    date,
    jeeStudents.map((s, i) => ({ studentId: s.id, status: (d + i) % 7 === 0 ? "ABSENT" : (d + i) % 5 === 0 ? "LATE" : "PRESENT" })),
    teacherCtx,
  );
}

for (const email of ["accounts@demo.test", "meera@demo.test", "prakash@demo.test", ...roster.map((r) => r[1])]) await activate(email);

console.log(`
Demo data ready. Every password is "${PASSWORD}".
  Platform console  ${env().PLATFORM_URL}/login    platform@demo.test
  Institute         ${instituteUrl(SLUG, "/login")}    admin@demo.test (admin), accounts@demo.test (accountant),
                    meera@demo.test (teacher), aarav@demo.test / riya@demo.test (students)
`);
await app.close();
