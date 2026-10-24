import { Role } from "@lms/db";
import { acceptInviteAndLogin, createTestApp, setupInstitute, unique, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const email = () => `${unique("a")}@example.in`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Institute with a course, a batch taught by one teacher, an unassigned second teacher and three students. */
async function world() {
  const s = await setupInstitute(ctx);
  const h = s.authed();
  const course = (await ctx.http().post("/courses").set(h).send({ code: "neet-27", name: "NEET 2027", fee: 65000.5, durationWeeks: 40 })).body;

  const teacherEmail = email();
  const otherEmail = email();
  const teacher = (await ctx.http().post("/teachers").set(h).send({ name: "Assigned Teacher", email: teacherEmail })).body;
  const other = (await ctx.http().post("/teachers").set(h).send({ name: "Other Teacher", email: otherEmail })).body;
  const teacherToken = await acceptInviteAndLogin(ctx, teacherEmail, s.inst.slug);
  const otherToken = await acceptInviteAndLogin(ctx, otherEmail, s.inst.slug);

  const batch = (
    await ctx.http().post("/batches").set(h).send({ courseId: course.id, name: "Evening", startDate: daysAgo(60), capacity: 3, teacherIds: [teacher.id] })
  ).body;
  const students = [];
  for (const name of ["Aarav Shah", "Bhavna Rao", "Chetan Das"]) {
    const e = email();
    const st = (await ctx.http().post("/students").set(h).send({ name, email: e, batchId: batch.id })).body;
    students.push({ ...st, email: e });
  }
  return { ...s, course, batch, teacher, other, teacherToken, otherToken, students };
}

describe("courses", () => {
  it("creates, lists and updates; codes are unique per institute", async () => {
    const { authed, course } = await world();
    expect(course).toMatchObject({ code: "NEET-27", fee: "65000.5", status: "DRAFT" });
    expect((await ctx.http().post("/courses").set(authed()).send({ code: "NEET-27", name: "Again", fee: 1 })).status).toBe(409);

    const other = await setupInstitute(ctx);
    expect((await ctx.http().post("/courses").set(other.authed()).send({ code: "NEET-27", name: "Theirs", fee: 1 })).status).toBe(201);

    const upd = await ctx.http().patch(`/courses/${course.id}`).set(authed()).send({ status: "PUBLISHED" });
    expect(upd.body.status).toBe("PUBLISHED");
    const list = await ctx.http().get("/courses").query({ status: "PUBLISHED" }).set(authed());
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([course.id]);
  });

  it("only deletes empty courses, and archived courses take no new batches or students", async () => {
    const { authed, course, students } = await world();
    expect((await ctx.http().delete(`/courses/${course.id}`).set(authed())).status).toBe(409);
    await ctx.http().patch(`/courses/${course.id}`).set(authed()).send({ status: "ARCHIVED" }).expect(200);
    expect((await ctx.http().post("/batches").set(authed()).send({ courseId: course.id, name: "Late", startDate: today() })).status).toBe(400);

    const empty = (await ctx.http().post("/courses").set(authed()).send({ code: "TMP", name: "Temp", fee: 0 })).body;
    await ctx.http().delete(`/courses/${empty.id}`).set(authed()).expect(204);
    expect(students).toHaveLength(3);
  });
});

describe("batches", () => {
  it("teachers see only the batches they're assigned to", async () => {
    const { authed, batch, teacherToken, otherToken } = await world();
    expect((await ctx.http().get("/batches").set(authed(teacherToken))).body.items.map((b: { id: string }) => b.id)).toEqual([batch.id]);
    expect((await ctx.http().get("/batches").set(authed(otherToken))).body.total).toBe(0);
    expect((await ctx.http().get(`/batches/${batch.id}`).set(authed(otherToken))).status).toBe(403);
    expect((await ctx.http().get(`/batches/${batch.id}/students`).set(authed(teacherToken))).body).toHaveLength(3);
  });

  it("teachers only see students enrolled in their batches", async () => {
    const { authed, students, teacherToken, otherToken } = await world();
    const outsider = (await ctx.http().post("/students").set(authed()).send({ name: "Unenrolled Student", email: email() })).body;
    expect((await ctx.http().get("/students").set(authed())).body.total).toBe(4);

    const seen = await ctx.http().get("/students").set(authed(teacherToken));
    expect(seen.body.items.map((s: { id: string }) => s.id).sort()).toEqual(students.map((s) => s.id).sort());
    expect((await ctx.http().get(`/students/${outsider.id}`).set(authed(teacherToken))).status).toBe(404);
    expect((await ctx.http().get(`/students/${students[0].id}`).set(authed(teacherToken))).status).toBe(200);
    expect((await ctx.http().get("/students").set(authed(otherToken))).body.total).toBe(0);
  });

  it("reassigning teachers moves access", async () => {
    const { authed, batch, other, teacherToken, otherToken } = await world();
    await ctx.http().put(`/batches/${batch.id}/teachers`).set(authed()).send({ teacherIds: [other.id] }).expect(200);
    expect((await ctx.http().get(`/batches/${batch.id}`).set(authed(otherToken))).status).toBe(200);
    expect((await ctx.http().get(`/batches/${batch.id}`).set(authed(teacherToken))).status).toBe(403);
  });

  it("enforces capacity and sane dates", async () => {
    const { authed, batch, course } = await world();
    const extra = await ctx.http().post("/students").set(authed()).send({ name: "Fourth Student", email: email() });
    const full = await ctx.http().post("/enrollments").set(authed()).send({ studentId: extra.body.id, batchId: batch.id });
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/full/);

    expect((await ctx.http().patch(`/batches/${batch.id}`).set(authed()).send({ capacity: 2 })).status).toBe(400);
    const backwards = await ctx.http().post("/batches").set(authed()).send({ courseId: course.id, name: "X", startDate: "2026-05-10", endDate: "2026-05-01" });
    expect(backwards.status).toBe(400);
  });

  it("can't use another institute's teachers, courses or students", async () => {
    const mine = await world();
    const theirs = await world();
    const h = mine.authed();
    expect((await ctx.http().put(`/batches/${mine.batch.id}/teachers`).set(h).send({ teacherIds: [theirs.teacher.id] })).status).toBe(400);
    expect((await ctx.http().post("/batches").set(h).send({ courseId: theirs.course.id, name: "X", startDate: today() })).status).toBe(404);
    expect((await ctx.http().post("/enrollments").set(h).send({ studentId: theirs.students[0].id, batchId: mine.batch.id })).status).toBe(404);
    expect((await ctx.http().get(`/batches/${theirs.batch.id}/students`).set(h)).status).toBe(404);
  });
});

describe("enrollments", () => {
  it("prevents double enrollment; dropping and re-enrolling reuses the record", async () => {
    const { authed, batch, students } = await world();
    const enrollmentId = students[0].enrollments[0].id;
    expect((await ctx.http().post("/enrollments").set(authed()).send({ studentId: students[0].id, batchId: batch.id })).status).toBe(409);
    await ctx.http().post(`/enrollments/${enrollmentId}/drop`).set(authed()).expect(200);
    const again = await ctx.http().post("/enrollments").set(authed()).send({ studentId: students[0].id, batchId: batch.id });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(enrollmentId);
    expect(again.body.status).toBe("ACTIVE");
  });

  it("the assigned teacher marks completion and is recorded as the one who did; others can't", async () => {
    const { inst, authed, students, teacherToken, otherToken } = await world();
    const enrollmentId = students[1].enrollments[0].id;
    expect((await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(authed(otherToken))).status).toBe(403);

    const done = await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(authed(teacherToken));
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    const by = await ctx.db.membership.findUniqueOrThrow({ where: { id: done.body.completedById }, include: { user: true } });
    expect(by).toMatchObject({ role: Role.TEACHER, instituteId: inst.id });
    expect(by.user.name).toBe("Assigned Teacher");

    expect((await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(authed(teacherToken))).status).toBe(400);
    expect((await ctx.http().post(`/enrollments/${enrollmentId}/reopen`).set(authed(teacherToken))).status).toBe(403); // admin only
    await ctx.http().post(`/enrollments/${enrollmentId}/reopen`).set(authed()).expect(200);
  });
});

describe("attendance", () => {
  it("teacher loads the register, marks it, and re-marking replaces the day's marks", async () => {
    const { authed, batch, students, teacherToken } = await world();
    const h = authed(teacherToken);
    const day = daysAgo(1);

    const empty = await ctx.http().get(`/batches/${batch.id}/attendance/${day}`).set(h);
    expect(empty.body.students).toHaveLength(3);
    expect(empty.body.students.every((s: { status: null }) => s.status === null)).toBe(true);

    const marks = [
      { studentId: students[0].id, status: "PRESENT" },
      { studentId: students[1].id, status: "ABSENT", remark: "Unwell" },
      { studentId: students[2].id, status: "LATE" },
    ];
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/${day}`).set(h).send({ records: marks })).body.marked).toBe(3);
    await ctx.http().put(`/batches/${batch.id}/attendance/${day}`).set(h).send({ records: [{ studentId: students[1].id, status: "EXCUSED" }] }).expect(200);

    const reg = await ctx.http().get(`/batches/${batch.id}/attendance/${day}`).set(h);
    expect(reg.body.takenBy).toBe("Assigned Teacher");
    expect(reg.body.students.map((s: { status: string | null }) => s.status)).toEqual([null, "EXCUSED", null]);
    const history = await ctx.http().get(`/batches/${batch.id}/attendance`).set(h);
    expect(history.body).toHaveLength(1);
  });

  it("refuses future dates, dates outside the batch, strangers and duplicates", async () => {
    const { authed, batch, students, otherToken } = await world();
    const rec = [{ studentId: students[0].id, status: "PRESENT" }];
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/${future}`).set(authed()).send({ records: rec })).status).toBe(400);
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/${daysAgo(90)}`).set(authed()).send({ records: rec })).status).toBe(400);
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/2026-02-30`).set(authed()).send({ records: rec })).status).toBe(400);
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/${today()}`).set(authed()).send({ records: [...rec, ...rec] })).status).toBe(400);
    expect((await ctx.http().put(`/batches/${batch.id}/attendance/${today()}`).set(authed(otherToken)).send({ records: rec })).status).toBe(403);

    const outsider = await ctx.http().post("/students").set(authed()).send({ name: "Not Enrolled", email: email() });
    const res = await ctx.http().put(`/batches/${batch.id}/attendance/${today()}`).set(authed()).send({ records: [{ studentId: outsider.body.id, status: "PRESENT" }] });
    expect(res.status).toBe(400);
  });

  it("summarises per student, ignoring excused days in the percentage", async () => {
    const { inst, authed, batch, students } = await world();
    const s0 = students[0];
    const marks = ["PRESENT", "LATE", "ABSENT", "EXCUSED", "PRESENT"];
    for (const [i, status] of marks.entries()) {
      await ctx.http().put(`/batches/${batch.id}/attendance/${daysAgo(i + 1)}`).set(authed()).send({ records: [{ studentId: s0.id, status }] }).expect(200);
    }
    const summary = await ctx.http().get(`/students/${s0.id}/attendance`).set(authed());
    expect(summary.body).toEqual([
      expect.objectContaining({ batchId: batch.id, total: 5, present: 2, late: 1, absent: 1, excused: 1, percentage: 75 }),
    ]);

    // The student sees the same numbers in their own portal, and nothing that isn't theirs.
    const token = await acceptInviteAndLogin(ctx, s0.email, inst.slug);
    const mine = await ctx.http().get("/me/attendance").set(authed(token));
    expect(mine.body[0]).toMatchObject({ percentage: 75, courseName: "NEET 2027" });
    const enrollments = await ctx.http().get("/me/enrollments").set(authed(token));
    expect(enrollments.body).toHaveLength(1);
    expect(enrollments.body[0].batch.teachers[0].teacher.membership.user.name).toBe("Assigned Teacher");
    expect((await ctx.http().get(`/students/${students[1].id}/attendance`).set(authed(token))).status).toBe(403);
    expect((await ctx.http().get("/batches").set(authed(token))).status).toBe(403);
  });
});
