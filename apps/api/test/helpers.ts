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
import { StorageService, type StoredObject } from "../src/storage/storage.service.js";
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

/**
 * In-memory stand-in for S3. URLs look like presigned ones and carry the key; `put` plays the
 * part of the browser uploading to the URL the API handed out.
 */
export class FakeStorage {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];
  async presignUpload(key: string, contentType: string, contentLength: number) {
    return `https://fake-s3.test/${key}?X-Amz-Signature=put&type=${encodeURIComponent(contentType)}&len=${contentLength}`;
  }
  async presignDownload(key: string, opts: { fileName?: string; inline?: boolean } = {}) {
    return `https://fake-s3.test/${key}?X-Amz-Signature=get&disposition=${opts.inline ? "inline" : "attachment"}&name=${encodeURIComponent(opts.fileName ?? "")}`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.bodies.delete(key);
    this.deleted.push(key);
  }
  bodies = new Map<string, Uint8Array>();
  /** Simulates the browser's PUT to an upload URL (optionally with real bytes). */
  put(uploadUrl: string, size: number, contentType: string, body?: Uint8Array) {
    const key = this.keyOf(uploadUrl);
    this.objects.set(key, { size, contentType });
    if (body) this.bodies.set(key, body);
  }
  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { size: body.length, contentType });
    this.bodies.set(key, body);
  }
  async getObject(key: string) {
    const body = this.bodies.get(key);
    if (!body) throw new Error(`NoSuchKey ${key}`);
    return body;
  }
  keyOf(url: string) {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  }
}

export class Mailbox {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
  last(to: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
  /** Pulls the ?token=... value out of the most recent email to `to` that carries one. */
  tokenFor(to: string): string {
    const withToken = this.sent.filter((m) => m.to === to && /token=/.test(m.text)).at(-1);
    const match = withToken?.text.match(/token=([A-Za-z0-9_-]+)/);
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
  storage: FakeStorage;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const mail = new Mailbox();
  const razorpay = new FakeRazorpay();
  const storage = new FakeStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(RazorpayService)
    .useValue(razorpay)
    .overrideProvider(StorageService)
    .useValue(storage)
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
    storage,
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

/** An active institute with a signed-in admin. `as(token)` builds the auth header. */
export async function setupInstitute(ctx: TestContext) {
  const inst = await createInstitute(ctx.db);
  // Real institutes get their chart of accounts and number sequences on activation.
  const { ProvisioningService } = await import("../src/platform/provisioning.service.js");
  await ctx.db.$transaction((tx) => ctx.app.get(ProvisioningService).seedInstitute(tx, inst.id));
  const admin = await createUser(ctx.db, { instituteId: inst.id, roles: ["INSTITUTE_ADMIN"] });
  const { token } = await login(ctx, admin.email, inst.slug);
  const authed = (t = token) => ({ Authorization: `Bearer ${t}`, "X-Institute-Slug": inst.slug });
  return { inst, admin, token, authed };
}

/** Accepts the latest invite sent to `email` and signs in, returning a bearer token. */
export async function acceptInviteAndLogin(ctx: TestContext, email: string, slug: string) {
  const token = ctx.mail.tokenFor(email);
  const accept = await ctx.http().post("/auth/invite/accept").send({ token, password: PASSWORD });
  if (accept.status !== 204) throw new Error(`invite accept failed: ${accept.status}`);
  return (await login(ctx, email, slug)).token;
}

/** Runs the two-step upload: ask for a URL, "PUT" the bytes, return the ticket for confirmation. */
export async function uploadFile(
  ctx: TestContext,
  headers: Record<string, string>,
  courseId: string,
  file: { fileName: string; mimeType: string; sizeBytes: number },
) {
  const res = await ctx.http().post(`/courses/${courseId}/materials/upload-url`).set(headers).send(file);
  if (res.status !== 200) throw new Error(`upload-url failed ${res.status}: ${JSON.stringify(res.body)}`);
  ctx.storage.put(res.body.uploadUrl, file.sizeBytes, file.mimeType);
  return res.body.uploadToken as string;
}
