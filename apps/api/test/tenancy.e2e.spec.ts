import { Role } from "@lms/db";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { createInstitute, createTestApp, createUser, login, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

async function twoInstitutes() {
  const a = await createInstitute(ctx.db);
  const b = await createInstitute(ctx.db);
  const adminA = await createUser(ctx.db, { instituteId: a.id, roles: [Role.INSTITUTE_ADMIN] });
  const adminB = await createUser(ctx.db, { instituteId: b.id, roles: [Role.INSTITUTE_ADMIN] });
  await createUser(ctx.db, { instituteId: b.id, roles: [Role.STUDENT] });
  return { a, b, adminA, adminB };
}

describe("tenant isolation", () => {
  it("institute endpoints only ever return the caller's institute", async () => {
    const { a, b, adminA } = await twoInstitutes();
    const { token } = await login(ctx, adminA.email, a.slug);

    const profile = await ctx.http().get("/institute").set("Authorization", `Bearer ${token}`);
    expect(profile.body.id).toBe(a.id);

    const members = await ctx.http().get("/institute/members").set("Authorization", `Bearer ${token}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(1);
    expect(members.body[0].user.email).toBe(adminA.email);
    expect(JSON.stringify(members.body)).not.toContain(b.id);
  });

  it("the app database role sees nothing without a tenant context, and only that tenant with one", async () => {
    const { a, b } = await twoInstitutes();
    const prisma = ctx.app.get(PrismaService);
    // Reach the RLS-restricted client directly, as a buggy query without tenant() would.
    const appClient = (prisma as unknown as { app: typeof ctx.db }).app;

    expect(await appClient.membership.count()).toBe(0);
    const seenByA = await prisma.tenant(a.id, (tx) => tx.membership.findMany({ select: { instituteId: true } }));
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((m) => m.instituteId === a.id)).toBe(true);

    // Writing another institute's row from inside A's context is refused by the policy.
    await expect(
      prisma.tenant(a.id, (tx) => tx.account.create({ data: { instituteId: b.id, code: "9999", name: "x", type: "ASSET" } })),
    ).rejects.toThrow();
  });

  it("composite foreign keys refuse cross-institute links even for the bypass role", async () => {
    const { a, b } = await twoInstitutes();
    const courseB = await ctx.db.course.create({ data: { instituteId: b.id, code: "C1", name: "B course", fee: 1000 } });
    await expect(
      ctx.db.batch.create({ data: { instituteId: a.id, courseId: courseB.id, name: "bad", startDate: new Date() } }),
    ).rejects.toThrow();
  });
});

describe("role checks", () => {
  it("students cannot use admin routes; institute users cannot use platform routes", async () => {
    const inst = await createInstitute(ctx.db);
    const student = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT] });
    const admin = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.INSTITUTE_ADMIN] });
    const s = await login(ctx, student.email, inst.slug);
    const ad = await login(ctx, admin.email, inst.slug);

    expect((await ctx.http().get("/institute").set("Authorization", `Bearer ${s.token}`)).status).toBe(200);
    expect((await ctx.http().get("/institute/members").set("Authorization", `Bearer ${s.token}`)).status).toBe(403);
    expect((await ctx.http().patch("/institute").set("Authorization", `Bearer ${s.token}`).send({ city: "Pune" })).status).toBe(403);
    expect((await ctx.http().get("/platform/institutes").set("Authorization", `Bearer ${ad.token}`)).status).toBe(403);
  });

  it("a platform admin who is also an institute member gets no platform powers from the institute session", async () => {
    const inst = await createInstitute(ctx.db);
    const both = await createUser(ctx.db, { platformAdmin: true, instituteId: inst.id, roles: [Role.TEACHER] });
    const { token } = await login(ctx, both.email, inst.slug);
    expect((await ctx.http().get("/platform/institutes").set("Authorization", `Bearer ${token}`)).status).toBe(403);
  });

  it("admins can update the profile, with validation", async () => {
    const inst = await createInstitute(ctx.db);
    const admin = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.INSTITUTE_ADMIN] });
    const { token } = await login(ctx, admin.email, inst.slug);
    const auth = { Authorization: `Bearer ${token}` };

    const ok = await ctx.http().patch("/institute").set(auth).send({ city: "Pune", gstin: "27aapfu0939f1zv" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ city: "Pune", gstin: "27AAPFU0939F1ZV" });
    expect((await ctx.http().patch("/institute").set(auth).send({ gstin: "nope" })).status).toBe(400);
    expect((await ctx.http().patch("/institute").set(auth).send({ status: "ACTIVE" })).status).toBe(400); // not a writable field
  });
});
