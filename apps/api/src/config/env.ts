import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_PLATFORM: z.string().url(),

  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),

  PLATFORM_HOST: z.string().default("lvh.me"),
  APP_URL_TEMPLATE: z.string().includes("{slug}").default("http://{slug}.lvh.me:3000"),
  PLATFORM_URL: z.string().url().default("http://lvh.me:3000"),
  CORS_ORIGINS: z.string().default(""),

  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("Coaching LMS <no-reply@lvh.me>"),

  // Object storage. On AWS leave endpoint and keys empty: the task's IAM role is used.
  S3_BUCKET: z.string().default("lms-private"),
  S3_REGION: z.string().default("ap-south-1"),
  S3_ENDPOINT: z.string().default(""),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false), // true for MinIO
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).default(500),

  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  PLATFORM_GST_RATE: z.coerce.number().min(0).max(100).default(18),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parses and validates process.env once; the app refuses to start on bad config. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n${issues.join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";

export function instituteUrl(slug: string, path = ""): string {
  return env().APP_URL_TEMPLATE.replace("{slug}", slug) + path;
}
