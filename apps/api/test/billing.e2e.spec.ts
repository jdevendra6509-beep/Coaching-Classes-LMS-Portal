import { InstituteStatus, Role, SubscriptionStatus, UserStatus } from "@lms/db";
import { createInstitute, createTestApp, createUser, login, signWebhook, unique, type TestContext } from "./helpers.js";

let ctx: TestContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const admin = await createUser(ctx.db, { platformAdmin: true });
  adminToken = (await login(ctx, admin.email)).token;
});
afterAll(() => ctx.close());

const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });

async function createPlan(price = 999) {
  const res = await ctx.http().post("/platform/plans").set(asAdmin()).send({
    code: unique("plan-"), name: "Starter", pricePerMonth: price, maxStudents: 200, maxStorageMb: 5120,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function signup(planCode: string, overrides: Record<string, string> = {}) {
  const slug = unique("acad");
  const res = await ctx.http().post("/signup").send({
    instituteName: "Bright Academy", slug, ownerName: "Asha Rao", email: `${slug}@example.in`, phone: "9876543210", planCode, ...overrides,
  });
  return { res, slug, email: overrides.email ?? `${slug}@example.in` };
}

function subscriptionEvent(event: string, subscriptionId: string, payment?: { id: string; amount: number }) {
  const now = Math.floor(Date.now() / 1000);
  return {
    event,
    payload: {
      subscription: { entity: { id: subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 } },
      ...(payment && { payment: { entity: { ...payment, status: "captured" } } }),
    },
  };
}

async function sendWebhook(body: object, eventId = unique("evt_")) {
  const { raw, signature } = signWebhook(body);
  return ctx
    .http()
    .post("/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .set("X-Razorpay-Event-Id", eventId)
    .send(raw);
}

describe("plans", () => {
  it("platform admins create plans (priced in Razorpay incl. GST) and the public sees active ones", async () => {
    const plan = await createPlan(1499);
    expect(plan.razorpayPlanId).toMatch(/^plan_test_/);
    const pub = await ctx.http().get("/plans");
    expect(pub.body.find((p: { code: string }) => p.code === plan.code)).toMatchObject({ name: "Starter", gstRate: 18 });

    await ctx.http().patch(`/platform/plans/${plan.id}`).set(asAdmin()).send({ isActive: false }).expect(200);
    expect((await ctx.http().get("/plans")).body.find((p: { code: string }) => p.code === plan.code)).toBeUndefined();
  });
});

describe("institute onboarding", () => {
  it("signup → pending; webhook-confirmed payment → active, provisioned, owner invited", async () => {
    const plan = await createPlan();
    const { res, slug, email } = await signup(plan.code);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug, razorpayKeyId: "rzp_test_dummy", amountPaise: 117882 });

    const inst = await ctx.db.institute.findUniqueOrThrow({ where: { slug } });
    expect(inst.status).toBe(InstituteStatus.PENDING_PAYMENT);
    expect(ctx.mail.last(email)).toBeUndefined(); // nothing is sent before payment

    // Owner can't sign in yet.
    const early = await ctx.http().post("/auth/login").set("X-Institute-Slug", slug).send({ email, password: "whatever-123" });
    expect(early.status).toBe(401);

    const hook = await sendWebhook(subscriptionEvent("subscription.charged", res.body.razorpaySubscriptionId, { id: unique("pay_"), amount: 117882 }));
    expect(hook.status).toBe(200);
    expect(hook.body.status).toBe("processed");

    const after = await ctx.db.institute.findUniqueOrThrow({
      where: { slug },
      include: { subscriptions: true, platformPayments: true, accounts: true, documentSequences: true },
    });
    expect(after.status).toBe(InstituteStatus.ACTIVE);
    expect(after.subscriptions[0].status).toBe(SubscriptionStatus.ACTIVE);
    expect(after.subscriptions[0].currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    expect(after.platformPayments).toHaveLength(1);
    expect(after.platformPayments[0].amount.toFixed(2)).toBe("999.00");
    expect(after.platformPayments[0].gstAmount.toFixed(2)).toBe("179.82");
    expect(after.accounts.length).toBeGreaterThanOrEqual(13);
    expect(after.documentSequences.map((s) => s.type).sort()).toEqual(["CERTIFICATE", "INVOICE", "RECEIPT"]);

    // The welcome email carries a set-password link on the institute's own subdomain.
    expect(ctx.mail.last(email)!.text).toContain(`http://${slug}.lvh.me:3000/accept-invite?token=`);
    const token = ctx.mail.tokenFor(email);
    await ctx.http().post("/auth/invite/accept").send({ token, password: "owner-password-1" }).expect(204);
    const ok = await ctx.http().post("/auth/login").set("X-Institute-Slug", slug).send({ email, password: "owner-password-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.roles).toEqual([Role.INSTITUTE_ADMIN]);
  });

  it("is idempotent: a redelivered event and a second event for the same payment record one payment", async () => {
    const plan = await createPlan();
    const { res, slug, email } = await signup(plan.code);
    const payment = { id: unique("pay_"), amount: 117882 };
    const body = subscriptionEvent("subscription.charged", res.body.razorpaySubscriptionId, payment);

    expect((await sendWebhook(body, "evt-same")).body.status).toBe("processed");
    expect((await sendWebhook(body, "evt-same")).body.status).toBe("duplicate");
    await sendWebhook(subscriptionEvent("subscription.activated", res.body.razorpaySubscriptionId, payment));

    const inst = await ctx.db.institute.findUniqueOrThrow({ where: { slug }, include: { platformPayments: true } });
    expect(inst.platformPayments).toHaveLength(1);
    expect(ctx.mail.sent.filter((m) => m.to === email)).toHaveLength(1);
  });

  it("rejects webhooks with a bad signature and changes nothing", async () => {
    const plan = await createPlan();
    const { res, slug } = await signup(plan.code);
    const { raw } = signWebhook(subscriptionEvent("subscription.charged", res.body.razorpaySubscriptionId, { id: unique("pay_"), amount: 1 }));
    const bad = await ctx.http().post("/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", "deadbeef").send(raw);
    expect(bad.status).toBe(400);
    expect((await ctx.db.institute.findUniqueOrThrow({ where: { slug } })).status).toBe(InstituteStatus.PENDING_PAYMENT);
  });

  it("failed renewals move the institute to past-due; a later charge restores it", async () => {
    const plan = await createPlan();
    const { res, slug } = await signup(plan.code);
    const subId = res.body.razorpaySubscriptionId;
    await sendWebhook(subscriptionEvent("subscription.charged", subId, { id: unique("pay_"), amount: 117882 }));
    await sendWebhook(subscriptionEvent("subscription.halted", subId));
    expect((await ctx.db.institute.findUniqueOrThrow({ where: { slug } })).status).toBe(InstituteStatus.PAST_DUE);
    await sendWebhook(subscriptionEvent("subscription.charged", subId, { id: unique("pay_"), amount: 117882 }));
    expect((await ctx.db.institute.findUniqueOrThrow({ where: { slug } })).status).toBe(InstituteStatus.ACTIVE);
  });

  it("reuses an existing account for the owner instead of creating or overwriting one", async () => {
    const plan = await createPlan();
    const existing = await createUser(ctx.db);
    const { res } = await signup(plan.code, { email: existing.email, ownerName: "Someone Else" });
    expect(res.status).toBe(201);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { email: existing.email } });
    expect(user.name).toBe(existing.name);
    expect(user.status).toBe(UserStatus.ACTIVE);
    await sendWebhook(subscriptionEvent("subscription.charged", res.body.razorpaySubscriptionId, { id: unique("pay_"), amount: 117882 }));
    expect(ctx.mail.last(existing.email)!.subject).toMatch(/You now have access/);
  });

  it("validates slugs: taken, reserved and malformed", async () => {
    const plan = await createPlan();
    const { slug } = await signup(plan.code);
    expect((await signup(plan.code, { slug })).res.status).toBe(409);
    expect((await signup(plan.code, { slug: "admin" })).res.status).toBe(400);
    expect((await signup(plan.code, { slug: "Bad_Slug!" })).res.status).toBe(400);
    expect((await ctx.http().get("/signup/slug-available").query({ slug })).body.available).toBe(false);
    expect((await ctx.http().get("/signup/slug-available").query({ slug: unique("free") })).body.available).toBe(true);
  });

  it("rolls the signup back if Razorpay is unavailable, freeing the slug", async () => {
    const plan = await createPlan();
    ctx.razorpay.failNext = true;
    const { res, slug } = await signup(plan.code);
    expect(res.status).toBe(502);
    expect(await ctx.db.institute.findUnique({ where: { slug } })).toBeNull();
  });
});

describe("platform console", () => {
  it("suspending blocks login and kills sessions; reactivating restores access", async () => {
    const inst = await createInstitute(ctx.db);
    await ctx.db.subscription.create({
      data: { instituteId: inst.id, planId: (await createPlan()).id, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 86400_000) },
    });
    const owner = await createUser(ctx.db, { instituteId: inst.id, roles: [Role.INSTITUTE_ADMIN] });
    const { cookies } = await login(ctx, owner.email, inst.slug);
    const rt = cookies.find((c) => c.startsWith("lms_rt="))!.split(";")[0];

    const s = await ctx.http().post(`/platform/institutes/${inst.id}/suspend`).set(asAdmin()).send({ reason: "Chargeback" });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe(InstituteStatus.SUSPENDED);
    expect((await ctx.http().post("/auth/refresh").set("Cookie", rt)).status).toBe(401);
    expect((await ctx.http().post("/auth/login").set("X-Institute-Slug", inst.slug).send({ email: owner.email, password: "correct-horse-battery" })).status).toBe(403);

    const r = await ctx.http().post(`/platform/institutes/${inst.id}/reactivate`).set(asAdmin());
    expect(r.body.status).toBe(InstituteStatus.ACTIVE);
    await login(ctx, owner.email, inst.slug);

    const audit = await ctx.db.auditLog.findMany({ where: { instituteId: inst.id, action: { startsWith: "institute." } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["institute.reactivate", "institute.suspend"]);
  });

  it("lists and searches institutes and payments", async () => {
    const inst = await createInstitute(ctx.db, { slug: unique("searchme") });
    const list = await ctx.http().get("/platform/institutes").query({ search: "searchme" }).set(asAdmin());
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(inst.id);
    expect((await ctx.http().get("/platform/payments").set(asAdmin())).status).toBe(200);
    expect((await ctx.http().get("/platform/institutes/not-a-uuid").set(asAdmin())).status).toBe(400);
  });
});
