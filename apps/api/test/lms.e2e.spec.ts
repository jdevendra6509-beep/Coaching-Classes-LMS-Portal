import { acceptInviteAndLogin, createTestApp, setupInstitute, unique, uploadFile, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const email = () => `${unique("l")}@example.in`;
const PDF = { fileName: "Kinematics Notes.pdf", mimeType: "application/pdf", sizeBytes: 120_000 };

/** A course taught by one teacher, a second course they don't teach, and an enrolled student. */
async function world() {
  const s = await setupInstitute(ctx);
  const h = s.authed();
  const course = (await ctx.http().post("/courses").set(h).send({ code: "PHY", name: "Physics", fee: 1000 })).body;
  const otherCourse = (await ctx.http().post("/courses").set(h).send({ code: "CHE", name: "Chemistry", fee: 1000 })).body;
  const tEmail = email();
  const teacher = (await ctx.http().post("/teachers").set(h).send({ name: "Physics Teacher", email: tEmail })).body;
  const batch = (await ctx.http().post("/batches").set(h).send({ courseId: course.id, name: "B1", startDate: "2026-01-01", teacherIds: [teacher.id] })).body;
  const sEmail = email();
  const student = (await ctx.http().post("/students").set(h).send({ name: "Enrolled Student", email: sEmail, batchId: batch.id })).body;
  const teacherH = s.authed(await acceptInviteAndLogin(ctx, tEmail, s.inst.slug));
  const studentH = s.authed(await acceptInviteAndLogin(ctx, sEmail, s.inst.slug));
  return { ...s, h, course, otherCourse, teacher, batch, student, teacherH, studentH };
}

describe("uploading course files", () => {
  it("teacher uploads a PDF; students see it only once published, and download via a short-lived link", async () => {
    const { course, teacherH, studentH } = await world();
    const uploadToken = await uploadFile(ctx, teacherH, course.id, PDF);
    const created = await ctx.http().post(`/courses/${course.id}/materials`).set(teacherH).send({ title: "Kinematics", uploadToken });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: "PDF", fileName: "Kinematics Notes.pdf", sizeBytes: 120_000, isPublished: false, uploadedBy: "Physics Teacher" });

    const hidden = await ctx.http().get(`/me/courses/${course.id}/materials`).set(studentH);
    expect(hidden.body.ungrouped).toEqual([]);
    expect((await ctx.http().get(`/me/materials/${created.body.id}/download`).set(studentH)).status).toBe(404);

    await ctx.http().patch(`/materials/${created.body.id}`).set(teacherH).send({ isPublished: true }).expect(200);
    const visible = await ctx.http().get(`/me/courses/${course.id}/materials`).set(studentH);
    expect(visible.body.course.name).toBe("Physics");
    expect(visible.body.ungrouped.map((m: { title: string }) => m.title)).toEqual(["Kinematics"]);

    const dl = await ctx.http().get(`/me/materials/${created.body.id}/download`).set(studentH);
    expect(dl.status).toBe(200);
    expect(dl.body.url).toContain("disposition=attachment");
    expect(dl.body.url).toContain(encodeURIComponent("Kinematics Notes.pdf"));
    expect(new Date(dl.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const inline = await ctx.http().get(`/me/materials/${created.body.id}/download`).query({ inline: true }).set(studentH);
    expect(inline.body.url).toContain("disposition=inline");
  });

  it("stores files under the institute and course, never at a path the client chooses", async () => {
    const { inst, course, h } = await world();
    const res = await ctx.http().post(`/courses/${course.id}/materials/upload-url`).set(h).send({ ...PDF, fileName: "../../etc/passwd.pdf" });
    const key = ctx.storage.keyOf(res.body.uploadUrl);
    expect(key).toMatch(new RegExp(`^institutes/${inst.id}/courses/${course.id}/[0-9a-f-]{36}\\.pdf$`));
  });

  it("rejects disallowed types, mismatched extensions and oversized files", async () => {
    const { course, h } = await world();
    const url = `/courses/${course.id}/materials/upload-url`;
    expect((await ctx.http().post(url).set(h).send({ fileName: "x.html", mimeType: "text/html", sizeBytes: 10 })).status).toBe(400);
    expect((await ctx.http().post(url).set(h).send({ fileName: "x.svg", mimeType: "image/svg+xml", sizeBytes: 10 })).status).toBe(400);
    expect((await ctx.http().post(url).set(h).send({ fileName: "x.exe", mimeType: "application/pdf", sizeBytes: 10 })).status).toBe(400);
    expect((await ctx.http().post(url).set(h).send({ ...PDF, sizeBytes: 51 * 1024 * 1024 })).status).toBe(400); // MAX_UPLOAD_MB=50 in tests
    expect((await ctx.http().post(url).set(h).send({ fileName: "big.png", mimeType: "image/png", sizeBytes: 21 * 1024 * 1024 })).status).toBe(400);
  });

  it("confirming checks the file really arrived and matches what was declared", async () => {
    const { course, h } = await world();
    const ask = await ctx.http().post(`/courses/${course.id}/materials/upload-url`).set(h).send(PDF);
    const create = () => ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title: "Notes", uploadToken: ask.body.uploadToken });

    expect((await create()).status).toBe(400); // nothing uploaded yet
    ctx.storage.put(ask.body.uploadUrl, PDF.sizeBytes + 1, PDF.mimeType);
    expect((await create()).status).toBe(400); // wrong size
    expect(ctx.storage.deleted).toContain(ctx.storage.keyOf(ask.body.uploadUrl)); // and the mismatched object is removed

    ctx.storage.put(ask.body.uploadUrl, PDF.sizeBytes, PDF.mimeType);
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409); // a ticket attaches one file once
  });

  it("an upload ticket only works for its own course and institute, and is never a login token", async () => {
    const a = await world();
    const b = await world();
    const token = await uploadFile(ctx, a.h, a.course.id, PDF);
    expect((await ctx.http().post(`/courses/${a.otherCourse.id}/materials`).set(a.h).send({ title: "x", uploadToken: token })).status).toBe(400);
    expect((await ctx.http().post(`/courses/${b.course.id}/materials`).set(b.h).send({ title: "x", uploadToken: token })).status).toBe(400);
    expect((await ctx.http().get("/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("saves https links, including videos, and hands them to students through the same check", async () => {
    const { course, h, studentH } = await world();
    expect((await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title: "Bad", externalUrl: "http://example.com" })).status).toBe(400);
    expect((await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title: "Neither" })).status).toBe(400);
    const video = await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({
      title: "Lecture 1", externalUrl: "https://youtu.be/abc123", linkType: "VIDEO", isPublished: true,
    });
    expect(video.status).toBe(201);
    expect(video.body.type).toBe("VIDEO");

    const list = await ctx.http().get(`/me/courses/${course.id}/materials`).set(studentH);
    expect(list.body.ungrouped[0].externalUrl).toBeUndefined();
    const dl = await ctx.http().get(`/me/materials/${video.body.id}/download`).set(studentH);
    expect(dl.body).toMatchObject({ url: "https://youtu.be/abc123", external: true });
  });

  it("deleting a material removes its file from storage", async () => {
    const { course, h } = await world();
    const ask = await ctx.http().post(`/courses/${course.id}/materials/upload-url`).set(h).send(PDF);
    ctx.storage.put(ask.body.uploadUrl, PDF.sizeBytes, PDF.mimeType);
    const m = await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title: "Gone soon", uploadToken: ask.body.uploadToken });
    await ctx.http().delete(`/materials/${m.body.id}`).set(h).expect(204);
    expect(ctx.storage.objects.has(ctx.storage.keyOf(ask.body.uploadUrl))).toBe(false);
  });
});

describe("who can see what", () => {
  async function publishedPdf(w: Awaited<ReturnType<typeof world>>) {
    const uploadToken = await uploadFile(ctx, w.h, w.course.id, PDF);
    return (await ctx.http().post(`/courses/${w.course.id}/materials`).set(w.h).send({ title: "Notes", uploadToken, isPublished: true })).body;
  }

  it("teachers manage only courses they teach", async () => {
    const { otherCourse, teacherH } = await world();
    expect((await ctx.http().post(`/courses/${otherCourse.id}/materials/upload-url`).set(teacherH).send(PDF)).status).toBe(403);
    expect((await ctx.http().get(`/courses/${otherCourse.id}/materials`).set(teacherH)).status).toBe(403);
  });

  it("students who aren't enrolled, or have dropped, can't list or download; completing keeps access", async () => {
    const w = await world();
    const m = await publishedPdf(w);
    const enrollmentId = w.student.enrollments[0].id;

    expect((await ctx.http().get(`/me/courses/${w.otherCourse.id}/materials`).set(w.studentH)).status).toBe(404);

    await ctx.http().post(`/enrollments/${enrollmentId}/complete`).set(w.teacherH).expect(200);
    expect((await ctx.http().get(`/me/materials/${m.id}/download`).set(w.studentH)).status).toBe(200);

    await ctx.http().post(`/enrollments/${enrollmentId}/reopen`).set(w.h).expect(200);
    await ctx.http().post(`/enrollments/${enrollmentId}/drop`).set(w.h).expect(200);
    expect((await ctx.http().get(`/me/courses/${w.course.id}/materials`).set(w.studentH)).status).toBe(404);
    expect((await ctx.http().get(`/me/materials/${m.id}/download`).set(w.studentH)).status).toBe(404);
  });

  it("nothing crosses institutes", async () => {
    const a = await world();
    const b = await world();
    const m = await publishedPdf(a);
    expect((await ctx.http().get(`/materials/${m.id}/download`).set(b.h)).status).toBe(404);
    expect((await ctx.http().get(`/me/materials/${m.id}/download`).set(b.studentH)).status).toBe(404);
    expect((await ctx.http().patch(`/materials/${m.id}`).set(b.h).send({ title: "pwned" })).status).toBe(404);
    expect((await ctx.http().get(`/courses/${a.course.id}/materials`).set(b.h)).status).toBe(404);
  });

  it("students can't use staff routes", async () => {
    const w = await world();
    expect((await ctx.http().get(`/courses/${w.course.id}/materials`).set(w.studentH)).status).toBe(403);
    expect((await ctx.http().post(`/courses/${w.course.id}/materials/upload-url`).set(w.studentH).send(PDF)).status).toBe(403);
  });
});

describe("modules and ordering", () => {
  it("groups materials into ordered modules; deleting a module keeps its materials", async () => {
    const { course, otherCourse, h, studentH } = await world();
    const m1 = (await ctx.http().post(`/courses/${course.id}/modules`).set(h).send({ title: "Unit 1" })).body;
    const m2 = (await ctx.http().post(`/courses/${course.id}/modules`).set(h).send({ title: "Unit 2" })).body;
    const empty = (await ctx.http().post(`/courses/${course.id}/modules`).set(h).send({ title: "Empty" })).body;
    const add = async (title: string, moduleId?: string) =>
      (await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title, externalUrl: `https://example.com/${title}`, moduleId, isPublished: true })).body;
    const a = await add("A", m1.id);
    const b = await add("B", m1.id);
    await add("C", m2.id);

    const order = await ctx.http().put(`/courses/${course.id}/materials/order`).set(h).send({ moduleId: m1.id, materialIds: [b.id, a.id] });
    expect(order.body.modules[0].materials.map((m: { title: string }) => m.title)).toEqual(["B", "A"]);
    expect((await ctx.http().put(`/courses/${course.id}/materials/order`).set(h).send({ moduleId: m1.id, materialIds: [b.id] })).status).toBe(400);

    const mods = await ctx.http().put(`/courses/${course.id}/modules/order`).set(h).send({ moduleIds: [m2.id, m1.id, empty.id] });
    expect(mods.body.modules.map((m: { title: string }) => m.title)).toEqual(["Unit 2", "Unit 1", "Empty"]);

    const forStudent = await ctx.http().get(`/me/courses/${course.id}/materials`).set(studentH);
    expect(forStudent.body.modules.map((m: { title: string }) => m.title)).toEqual(["Unit 2", "Unit 1"]); // empty one hidden

    const foreign = (await ctx.http().post(`/courses/${otherCourse.id}/modules`).set(h).send({ title: "Other" })).body;
    expect((await ctx.http().patch(`/materials/${a.id}`).set(h).send({ moduleId: foreign.id })).status).toBe(400);

    await ctx.http().delete(`/modules/${m1.id}`).set(h).expect(204);
    const after = await ctx.http().get(`/courses/${course.id}/materials`).set(h);
    expect(after.body.ungrouped.map((m: { title: string }) => m.title)).toEqual(["B", "A"]);
  });
});

describe("storage quota", () => {
  it("blocks uploads beyond the plan's storage and reports usage", async () => {
    const { inst, course, h } = await world();
    const plan = await ctx.db.plan.create({ data: { code: unique("small"), name: "Small", pricePerMonth: 1, maxStudents: 100, maxStorageMb: 1 } });
    await ctx.db.subscription.create({ data: { instituteId: inst.id, planId: plan.id, status: "ACTIVE" } });
    const file = { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 600 * 1024 };

    const t1 = await uploadFile(ctx, h, course.id, file);
    await ctx.http().post(`/courses/${course.id}/materials`).set(h).send({ title: "First", uploadToken: t1 }).expect(201);
    const second = await ctx.http().post(`/courses/${course.id}/materials/upload-url`).set(h).send(file);
    expect(second.status).toBe(403);
    expect(second.body.code).toBe("STORAGE_LIMIT");

    const usage = await ctx.http().get("/institute/storage").set(h);
    expect(usage.body).toEqual({ usedBytes: 600 * 1024, limitBytes: 1024 * 1024 });
  });
});

describe("institute logo", () => {
  it("uploads a logo shown on the public login page; replacing it deletes the old one", async () => {
    const { inst, h } = await world();
    const upload = async () => {
      const ask = await ctx.http().post("/institute/logo/upload-url").set(h).send({ mimeType: "image/png", sizeBytes: 50_000 });
      ctx.storage.put(ask.body.uploadUrl, 50_000, "image/png");
      await ctx.http().post("/institute/logo").set(h).send({ uploadToken: ask.body.uploadToken }).expect(200);
      return ctx.storage.keyOf(ask.body.uploadUrl);
    };
    const first = await upload();
    const pub = await ctx.http().get(`/public/institutes/${inst.slug}`);
    expect(pub.body).toMatchObject({ slug: inst.slug, name: inst.name });
    expect(pub.body.logoUrl).toContain(first);

    await upload();
    expect(ctx.storage.deleted).toContain(first);

    expect((await ctx.http().post("/institute/logo/upload-url").set(h).send({ mimeType: "image/svg+xml", sizeBytes: 100 })).status).toBe(400);
    expect((await ctx.http().get("/public/institutes/no-such-place")).status).toBe(404);
  });
});
