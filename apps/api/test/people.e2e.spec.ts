import { Role, UserStatus } from "@lms/db";
import {
  acceptInviteAndLogin, createInstitute, createTestApp, createUser, login, PASSWORD, setupInstitute, unique, type TestContext,
} from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const email = () => `${unique("p")}@example.in`;

describe("teachers", () => {
  it("admin adds a teacher, who gets an invite on the institute's subdomain and can sign in as a teacher", async () => {
    const { inst, authed } = await setupInstitute(ctx);
    const e = email();
    const res = await ctx.http().post("/teachers").set(authed()).send({ name: "Meera Iyer", email: e, employeeCode: "T-01", joiningDate: "2026-06-01" });
    expect(res.status).toBe(201);
    expect(res.body.membership.user).toMatchObject({ name: "Meera Iyer", email: e, status: UserStatus.INVITED });
    expect(ctx.mail.last(e)!.text).toContain(`http://${inst.slug}.lvh.me:3000/accept-invite?token=`);

    const token = await acceptInviteAndLogin(ctx, e, inst.slug);
    const me = await ctx.http().get("/auth/me").set(authed(token));
    expect(me.body.roles).toEqual([Role.TEACHER]);

    const list = await ctx.http().get("/teachers").query({ search: "meera" }).set(authed());
    expect(list.body.total).toBe(1);
    expect((await ctx.http().get("/teachers").query({ search: "T-01" }).set(authed())).body.total).toBe(1);
  });

  it("rejects adding the same teacher twice", async () => {
    const { authed } = await setupInstitute(ctx);
    const e = email();
    await ctx.http().post("/teachers").set(authed()).send({ name: "A Teacher", email: e }).expect(201);
    const dup = await ctx.http().post("/teachers").set(authed()).send({ name: "A Teacher", email: e });
    expect(dup.status).toBe(409);
  });

  it("reuses an account from another institute without changing it, and only the owner can rename it", async () => {
    const other = await createInstitute(ctx.db);
    const existing = await createUser(ctx.db, { instituteId: other.id, roles: [Role.TEACHER] });
    const { authed } = await setupInstitute(ctx);

    const res = await ctx.http().post("/teachers").set(authed()).send({ name: "Different Name", email: existing.email });
    expect(res.status).toBe(201);
    expect(res.body.membership.user.name).toBe(existing.name);
    expect(ctx.mail.last(existing.email)!.subject).toMatch(/You now have access/);

    const rename = await ctx.http().patch(`/teachers/${res.body.id}`).set(authed()).send({ name: "Hijacked" });
    expect(rename.status).toBe(403);
    const profileOnly = await ctx.http().patch(`/teachers/${res.body.id}`).set(authed()).send({ qualification: "M.Sc. Physics" });
    expect(profileOnly.status).toBe(200);
    expect(profileOnly.body.qualification).toBe("M.Sc. Physics");
  });

  it("deactivating signs the teacher out and blocks login; activating restores it", async () => {
    const { inst, authed } = await setupInstitute(ctx);
    const e = email();
    const t = await ctx.http().post("/teachers").set(authed()).send({ name: "Temp Teacher", email: e });
    await acceptInviteAndLogin(ctx, e, inst.slug);
    const { cookies } = await login(ctx, e, inst.slug);
    const rt = cookies.find((c) => c.startsWith("lms_rt="))!.split(";")[0];

    await ctx.http().post(`/teachers/${t.body.id}/deactivate`).set(authed()).expect(200);
    expect((await ctx.http().post("/auth/refresh").set("Cookie", rt)).status).toBe(401);
    expect((await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: e, password: PASSWORD })).status).toBe(401);

    await ctx.http().post(`/teachers/${t.body.id}/activate`).set(authed()).expect(200);
    await login(ctx, e, inst.slug);
  });

  it("is admin-only", async () => {
    const { inst } = await setupInstitute(ctx);
    const teacher = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.TEACHER] });
    const { token } = await login(ctx, teacher.email, inst.slug);
    expect((await ctx.http().get("/teachers").set({ Authorization: `Bearer ${token}` })).status).toBe(403);
  });
});

describe("students", () => {
  it("generates admission numbers in sequence and accepts custom ones", async () => {
    const { authed } = await setupInstitute(ctx);
    const a = await ctx.http().post("/students").set(authed()).send({ name: "Student One", email: email() });
    const b = await ctx.http().post("/students").set(authed()).send({ name: "Student Two", email: email(), guardianPhone: "9876543210" });
    const c = await ctx.http().post("/students").set(authed()).send({ name: "Student Three", email: email(), admissionNo: "2026/JEE/7" });
    expect([a.body.admissionNo, b.body.admissionNo, c.body.admissionNo]).toEqual(["ADM-00001", "ADM-00002", "2026/JEE/7"]);

    const dup = await ctx.http().post("/students").set(authed()).send({ name: "Student Four", email: email(), admissionNo: "2026/JEE/7" });
    expect(dup.status).toBe(409);
    // The failed attempt didn't burn a number.
    const d = await ctx.http().post("/students").set(authed()).send({ name: "Student Five", email: email() });
    expect(d.body.admissionNo).toBe("ADM-00003");
  });

  it("validates input", async () => {
    const { authed } = await setupInstitute(ctx);
    const bad = await ctx.http().post("/students").set(authed()).send({ name: "X", email: "nope", guardianPhone: "12" });
    expect(bad.status).toBe(400);
  });

  it("enforces the plan's student limit", async () => {
    const { inst, authed } = await setupInstitute(ctx);
    const plan = await ctx.db.plan.create({ data: { code: unique("tiny"), name: "Tiny", pricePerMonth: 1, maxStudents: 2, maxStorageMb: 10 } });
    await ctx.db.subscription.create({ data: { instituteId: inst.id, planId: plan.id, status: "ACTIVE" } });

    await ctx.http().post("/students").set(authed()).send({ name: "One One", email: email() }).expect(201);
    const second = await ctx.http().post("/students").set(authed()).send({ name: "Two Two", email: email() });
    const third = await ctx.http().post("/students").set(authed()).send({ name: "Three Three", email: email() });
    expect(third.status).toBe(403);
    expect(third.body.code).toBe("PLAN_LIMIT");

    // Deactivating frees a seat; reactivating it again is refused while full.
    await ctx.http().post(`/students/${second.body.id}/deactivate`).set(authed()).expect(200);
    await ctx.http().post("/students").set(authed()).send({ name: "Three Three", email: email() }).expect(201);
    expect((await ctx.http().post(`/students/${second.body.id}/activate`).set(authed())).status).toBe(403);
  });

  it("can't see or touch another institute's students", async () => {
    const a = await setupInstitute(ctx);
    const b = await setupInstitute(ctx);
    const studentB = await ctx.http().post("/students").set(b.authed()).send({ name: "B Student", email: email() });
    expect((await ctx.http().get(`/students/${studentB.body.id}`).set(a.authed())).status).toBe(404);
    expect((await ctx.http().patch(`/students/${studentB.body.id}`).set(a.authed()).send({ address: "x" })).status).toBe(404);
    expect((await ctx.http().post(`/students/${studentB.body.id}/deactivate`).set(a.authed())).status).toBe(404);
    expect((await ctx.http().get("/students").set(a.authed())).body.total).toBe(0);
  });
});

describe("CSV import", () => {
  async function withBatch() {
    const s = await setupInstitute(ctx);
    const course = await ctx.http().post("/courses").set(s.authed()).send({ code: "JEE26", name: "JEE 2026", fee: 50000 });
    const batch = await ctx.http().post("/batches").set(s.authed()).send({ courseId: course.body.id, name: "Morning A", startDate: "2026-04-01" });
    return { ...s, batchId: batch.body.id as string };
  }

  it("reports every problem with its line number and imports nothing", async () => {
    const { inst, authed } = await withBatch();
    await ctx.http().post("/students").set(authed()).send({ name: "Already Here", email: "already@example.in" }).expect(201);
    const csv = [
      "Name,Email,Phone,Batch",
      "Good Student,good@example.in,9876543210,Morning A",
      "Bad Email,not-an-email,,",
      "Dup,good@example.in,,",
      "Lost,lost@example.in,,Evening Z",
      "Existing,already@example.in,,",
    ].join("\n");

    const res = await ctx.http().post("/students/import").set(authed()).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ row: 3, field: "email" }),
      expect.objectContaining({ row: 4, field: "email", message: "duplicate of line 2" }),
      expect.objectContaining({ row: 5, field: "batch", message: 'no batch named "Evening Z"' }),
      expect.objectContaining({ row: 6, field: "email", message: "already a student here" }),
    ]);
    expect(await ctx.db.student.count({ where: { instituteId: inst.id } })).toBe(1);
  });

  it("dry run validates without writing; a real run imports, enrolls and invites", async () => {
    const { inst, authed, batchId } = await withBatch();
    const csv = 'name,email,admission no,dob,parent phone,batch\n"Rao, Asha",asha.rao@example.in,,2010-05-04,9876543210,morning a\nRavi Kumar,ravi.k@example.in,R-77,,,\n';

    const dry = await ctx.http().post("/students/import").set(authed()).send({ csv, dryRun: true });
    expect(dry.body).toEqual({ rows: 2, imported: 0, valid: true, errors: [] });
    expect(await ctx.db.student.count({ where: { instituteId: inst.id } })).toBe(0);

    const real = await ctx.http().post("/students/import").set(authed()).send({ csv });
    expect(real.body).toMatchObject({ rows: 2, imported: 2, valid: true });

    const students = await ctx.http().get("/students").set(authed());
    const asha = students.body.items.find((s: { membership: { user: { email: string } } }) => s.membership.user.email === "asha.rao@example.in");
    expect(asha).toMatchObject({ admissionNo: "ADM-00001", guardianPhone: "9876543210", dateOfBirth: "2010-05-04T00:00:00.000Z" });
    expect(asha.membership.user.name).toBe("Rao, Asha");
    expect(asha.enrollments[0].batch.id).toBe(batchId);
    await vi.waitFor(() => expect(ctx.mail.last("ravi.k@example.in")).toBeDefined());
  });

  it("refuses files without the required columns", async () => {
    const { authed } = await withBatch();
    const res = await ctx.http().post("/students/import").set(authed()).send({ csv: "first,last\nA,B" });
    expect(res.status).toBe(400);
  });
});

describe("staff", () => {
  it("adds an accountant who can list students but not create them", async () => {
    const { inst, authed } = await setupInstitute(ctx);
    const e = email();
    await ctx.http().post("/staff").set(authed()).send({ name: "Acc Ountant", email: e, role: Role.ACCOUNTANT }).expect(201);
    const token = await acceptInviteAndLogin(ctx, e, inst.slug);
    expect((await ctx.http().get("/students").set(authed(token))).status).toBe(200);
    expect((await ctx.http().post("/students").set(authed(token)).send({ name: "No Way", email: email() })).status).toBe(403);
  });

  it("protects the last admin and the caller's own membership", async () => {
    const { inst, admin, authed } = await setupInstitute(ctx);
    const own = await ctx.db.membership.findFirstOrThrow({ where: { instituteId: inst.id, userId: admin.id } });
    expect((await ctx.http().post(`/staff/${own.id}/deactivate`).set(authed())).status).toBe(400);

    const e = email();
    const second = await ctx.http().post("/staff").set(authed()).send({ name: "Second Admin", email: e, role: Role.INSTITUTE_ADMIN });
    const token2 = await acceptInviteAndLogin(ctx, e, inst.slug);
    // Admin 2 can deactivate admin 1, after which admin 2 is the last admin and stays.
    await ctx.http().post(`/staff/${own.id}/deactivate`).set(authed(token2)).expect(200);
    expect((await ctx.http().post(`/staff/${second.body.id}/deactivate`).set(authed(token2))).status).toBe(400);
  });
});
