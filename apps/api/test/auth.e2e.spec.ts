import { InstituteStatus, Role, UserStatus } from "@lms/db";
import { totpCode } from "../src/auth/totp.js";
import { createInstitute, createTestApp, createUser, login, PASSWORD, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const refreshCookie = (cookies: string[]) => cookies.find((c) => c.startsWith("lms_rt="))!.split(";")[0];

describe("login", () => {
  it("signs a member in to their institute and sets httpOnly cookies", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.INSTITUTE_ADMIN, Role.TEACHER] });

    const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.institute.slug).toBe(inst.slug);
    expect(res.body.roles.sort()).toEqual([Role.INSTITUTE_ADMIN, Role.TEACHER]);
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = res.get("Set-Cookie")!;
    expect(cookies.find((c) => c.startsWith("lms_rt="))).toMatch(/HttpOnly/);

    const me = await ctx.http().get("/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
    expect(me.body.institute.id).toBe(inst.id);
  });

  it("resolves the institute from the subdomain when no header is sent", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT] });
    const res = await ctx.http().post("/auth/login").set("Host", `${inst.slug}.lvh.me`).send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.institute.slug).toBe(inst.slug);
  });

  it("gives the same answer for a wrong password, an unknown email and a non-member", async () => {
    const a = await createInstitute(ctx.db);
    const b = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: a.id, roles: [Role.STUDENT] });

    const attempts = [
      { slug: a.slug, email: user.email, password: "wrong-password" },
      { slug: a.slug, email: "nobody@example.in", password: PASSWORD },
      { slug: b.slug, email: user.email, password: PASSWORD },
      { slug: "no-such-institute", email: user.email, password: PASSWORD },
    ];
    for (const { slug, ...body } of attempts) {
      const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", slug).send(body);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid email or password");
    }
  });

  it("refuses invited (no password yet) and disabled users", async () => {
    const inst = await createInstitute(ctx.db);
    for (const status of [UserStatus.INVITED, UserStatus.DISABLED]) {
      const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT], status });
      const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(401);
    }
  });

  it("blocks institutes that are not active, but allows the past-due grace period", async () => {
    for (const [status, expected] of [
      [InstituteStatus.SUSPENDED, 403],
      [InstituteStatus.PENDING_PAYMENT, 403],
      [InstituteStatus.CANCELLED, 403],
      [InstituteStatus.PAST_DUE, 200],
    ] as const) {
      const inst = await createInstitute(ctx.db, { status });
      const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.INSTITUTE_ADMIN] });
      const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: user.email, password: PASSWORD });
      expect(res.status, status).toBe(expected);
    }
  });

  it("only lets platform admins sign in without an institute", async () => {
    const admin = await createUser(ctx.db, { platformAdmin: true });
    const plain = await createUser(ctx.db);
    expect((await login(ctx, admin.email)).body.isPlatformAdmin).toBe(true);
    const res = await ctx.http().post("/auth/login").send({ email: plain.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("validates the request body", async () => {
    const res = await ctx.http().post("/auth/login").send({ email: "not-an-email", password: "x", extra: 1 });
    expect(res.status).toBe(400);
  });
});

describe("tokens and sessions", () => {
  it("rejects a token presented on another institute's host", async () => {
    const a = await createInstitute(ctx.db);
    const b = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: a.id, roles: [Role.INSTITUTE_ADMIN] });
    const { token } = await login(ctx, user.email, a.slug);

    const res = await ctx.http().get("/institute").set("Authorization", `Bearer ${token}`).set("X-Institute-Slug", b.slug);
    expect(res.status).toBe(401);
  });

  it("rejects missing, malformed and forged tokens", async () => {
    expect((await ctx.http().get("/auth/me")).status).toBe(401);
    expect((await ctx.http().get("/auth/me").set("Authorization", "Bearer abc")).status).toBe(401);
    const forged =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwicGEiOnRydWV9.0000000000000000000000000000000000000000000";
    expect((await ctx.http().get("/platform/institutes").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("only accepts tokens of type access, even when correctly signed", async () => {
    const { JwtService } = await import("@nestjs/jwt");
    const admin = await createUser(ctx.db, { platformAdmin: true });
    const jwt = ctx.app.get(JwtService);
    const claims = { sub: admin.id, sid: "x", pa: true, iid: null, slug: null, roles: [] };
    expect((await ctx.http().get("/auth/me").set("Authorization", `Bearer ${await jwt.signAsync({ ...claims, typ: "upload" })}`)).status).toBe(401);
    expect((await ctx.http().get("/auth/me").set("Authorization", `Bearer ${await jwt.signAsync(claims)}`)).status).toBe(401);
  });

  it("rotates refresh tokens: the old one stops working", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT] });
    const { cookies } = await login(ctx, user.email, inst.slug);
    const first = refreshCookie(cookies);

    const r1 = await ctx.http().post("/auth/refresh").set("X-Institute-Slug", inst.slug).set("Cookie", first);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const second = refreshCookie(r1.get("Set-Cookie")!);
    expect(second).not.toBe(first);

    expect((await ctx.http().post("/auth/refresh").set("Cookie", first)).status).toBe(401);
    expect((await ctx.http().post("/auth/refresh").set("Cookie", second)).status).toBe(200);
  });

  it("stops refreshing once the membership is deactivated", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.TEACHER] });
    const { cookies } = await login(ctx, user.email, inst.slug);
    await ctx.db.membership.updateMany({ where: { userId: user.id }, data: { isActive: false } });
    expect((await ctx.http().post("/auth/refresh").set("Cookie", refreshCookie(cookies))).status).toBe(401);
  });

  it("logout revokes the session", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT] });
    const { cookies } = await login(ctx, user.email, inst.slug);
    const rt = refreshCookie(cookies);
    expect((await ctx.http().post("/auth/logout").set("Cookie", rt)).status).toBe(204);
    expect((await ctx.http().post("/auth/refresh").set("Cookie", rt)).status).toBe(401);
  });
});

describe("invites and password reset", () => {
  it("an invite link sets the password once and activates the account", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT], status: UserStatus.INVITED });
    const { AuthService } = await import("../src/auth/auth.service.js");
    const auth = ctx.app.get(AuthService);
    const token = await ctx.db.$transaction((tx) => auth.issueEmailToken(tx, user.id, "INVITE", 3600));

    const ok = await ctx.http().post("/auth/invite/accept").send({ token, password: "brand-new-password" });
    expect(ok.status).toBe(204);
    const again = await ctx.http().post("/auth/invite/accept").send({ token, password: "another-password" });
    expect(again.status).toBe(401);

    const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: user.email, password: "brand-new-password" });
    expect(res.status).toBe(200);
  });

  it("reset emails a link to the institute's subdomain; using it revokes existing sessions", async () => {
    const inst = await createInstitute(ctx.db);
    const user = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.STUDENT] });
    const { cookies } = await login(ctx, user.email, inst.slug);

    const forgot = await ctx.http().post("/auth/password/forgot").set("X-Institute-Slug", inst.slug).send({ email: user.email });
    expect(forgot.status).toBe(204);
    expect(ctx.mail.last(user.email)!.text).toContain(`http://${inst.slug}.lvh.me:3000/reset-password?token=`);

    const token = ctx.mail.tokenFor(user.email);
    expect((await ctx.http().post("/auth/password/reset").send({ token, password: "new-password-123" })).status).toBe(204);
    expect((await ctx.http().post("/auth/refresh").set("Cookie", refreshCookie(cookies))).status).toBe(401);
    const res = await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: user.email, password: "new-password-123" });
    expect(res.status).toBe(200);
  });

  it("does not reveal whether an email exists", async () => {
    const before = ctx.mail.sent.length;
    const res = await ctx.http().post("/auth/password/forgot").send({ email: "ghost@example.in" });
    expect(res.status).toBe(204);
    expect(ctx.mail.sent.length).toBe(before);
  });
});

describe("MFA", () => {
  it("enforces the authenticator code at login once enabled", async () => {
    const admin = await createUser(ctx.db, { platformAdmin: true });
    const { token } = await login(ctx, admin.email);
    const auth = { Authorization: `Bearer ${token}` };

    const setup = await ctx.http().post("/auth/mfa/setup").set(auth);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const stored = await ctx.db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.mfaSecret).not.toContain(setup.body.secret); // encrypted at rest

    expect((await ctx.http().post("/auth/mfa/enable").set(auth).send({ code: "000000" })).status).toBe(401);
    expect((await ctx.http().post("/auth/mfa/enable").set(auth).send({ code: totpCode(setup.body.secret) })).status).toBe(204);

    const without = await ctx.http().post("/auth/login").send({ email: admin.email, password: PASSWORD });
    expect(without.status).toBe(401);
    expect(without.body.code).toBe("MFA_REQUIRED");
    const withCode = await ctx.http().post("/auth/login").send({ email: admin.email, password: PASSWORD, otp: totpCode(setup.body.secret) });
    expect(withCode.status).toBe(200);
  });
});
