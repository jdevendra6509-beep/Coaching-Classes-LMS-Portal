import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createPrismaClient, InstituteStatus, type PrismaClient, type Role, UserStatus } from "@lms/db";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import type { MailMessage } from "../src/mail/mail.service.js";
import { MailService } from "../src/mail/mail.service.js";
import { RazorpayService } from "../src/platform/razorpay.service.js";
import { configureApp } from "../src/setup.js";

/** Real signature verification, fake network calls. */
export class FakeRazorpay extends RazorpayService {
  private n = 0;
  failNext = false;
  override async createPlan() {
    return `plan_test_${++this.n}`;
  }
  override async createSubscription() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("razorpay down");
    }
    const id = `sub_test_${++this.n}`;
    return { id, shortUrl: `https://rzp.io/i/${id}` };
  }
  override async cancelSubscription() {}
}

export class Mailbox {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
  last(to: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
  /** Pulls the ?token=... value out of the most recent email to `to`. */
  tokenFor(to: string): string {
    const match = this.last(to)?.text.match(/token=([A-Za-z0-9_-]+)/);
    if (!match) throw new Error(`No token email for ${to}`);
    return match[1];
  }
}

export interface TestContext {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  db: PrismaClient;
  mail: Mailbox;
  razorpay: FakeRazorpay;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const mail = new Mailbox();
  const razorpay = new FakeRazorpay();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(RazorpayService)
    .useValue(razorpay)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: ["error"] });
  configureApp(app);
  await app.init();
  const db = createPrismaClient(process.env.DATABASE_URL_PLATFORM!);
  return {
    app,
    http: () => request(app.getHttpServer()),
    db,
    mail,
    razorpay,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

let counter = 0;
export const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${++counter}`;

export async function createInstitute(db: PrismaClient, opts: { slug?: string; status?: InstituteStatus } = {}) {
  const slug = opts.slug ?? unique("inst");
  return db.institute.create({
    data: { slug, name: `Institute ${slug}`, email: `${slug}@example.in`, phone: "9999999999", status: opts.status ?? InstituteStatus.ACTIVE },
  });
}

export const PASSWORD = "correct-horse-battery";

export async function createUser(
  db: PrismaClient,
  opts: { email?: string; instituteId?: string; roles?: Role[]; platformAdmin?: boolean; status?: UserStatus } = {},
) {
  const email = opts.email ?? `${unique("user")}@example.in`;
  const user = await db.user.create({
    data: {
      email,
      name: email.split("@")[0],
      passwordHash: await hashPassword(PASSWORD),
      isPlatformAdmin: opts.platformAdmin ?? false,
      status: opts.status ?? UserStatus.ACTIVE,
    },
  });
  for (const role of opts.roles ?? []) {
    await db.membership.create({ data: { instituteId: opts.instituteId!, userId: user.id, role } });
  }
  return user;
}

/** Logs in and returns the bearer token plus the refresh cookie. */
export async function login(ctx: TestContext, email: string, slug?: string, extra: Record<string, string> = {}) {
  const req = ctx.http().post("/auth/login");
  if (slug) req.set("X-Institute-Slug", slug);
  const res = await req.send({ email, password: PASSWORD, ...extra });
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, cookies: res.get("Set-Cookie") ?? [], body: res.body };
}

export function signWebhook(body: object, secret = process.env.RAZORPAY_WEBHOOK_SECRET!) {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac("sha256", secret).update(raw).digest("hex") };
}
