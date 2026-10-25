// Deployment step, run once per release before the new API tasks start:
//   1. apply Prisma migrations,
//   2. (re)apply row-level security, grants and role setup (prisma/sql/rls.sql, idempotent),
//   3. set the app roles' passwords from the environment (Secrets Manager in production).
//
// Env: DATABASE_URL_MIGRATE (owner), and optionally LMS_APP_PASSWORD / LMS_PLATFORM_PASSWORD.
// Without those, the passwords are taken from DATABASE_URL / DATABASE_URL_PLATFORM when they
// connect as lms_app / lms_platform, so each password is written down in one place only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error("DATABASE_URL_MIGRATE is required");

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: root, stdio: "inherit" });

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SET client_min_messages = warning");
  await client.query(readFileSync(join(root, "prisma/sql/rls.sql"), "utf8"));
  const roles = [
    ["lms_app", "LMS_APP_PASSWORD", "DATABASE_URL"],
    ["lms_platform", "LMS_PLATFORM_PASSWORD", "DATABASE_URL_PLATFORM"],
  ];
  for (const [role, passwordEnv, urlEnv] of roles) {
    const password = process.env[passwordEnv] || passwordFromUrl(process.env[urlEnv], role);
    if (password) await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    console.log(`Role ${role}: password ${password ? "set" : "unchanged"}`);
  }
  console.log("Row-level security applied");
} finally {
  await client.end();
}

/** The password of a URL that logs in as `role` (or `role.<tenant>`, as Supabase's pooler expects). */
function passwordFromUrl(value, role) {
  if (!value) return undefined;
  const u = new URL(value);
  const user = decodeURIComponent(u.username);
  return user === role || user.startsWith(`${role}.`) ? decodeURIComponent(u.password) : undefined;
}
