// Deployment step, run once per release before the new API tasks start:
//   1. apply Prisma migrations,
//   2. (re)apply row-level security, grants and role setup (prisma/sql/rls.sql, idempotent),
//   3. set the app roles' passwords from the environment (Secrets Manager in production).
//
// Env: DATABASE_URL_MIGRATE (owner), and optionally LMS_APP_PASSWORD / LMS_PLATFORM_PASSWORD.
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
  for (const [role, env] of [["lms_app", "LMS_APP_PASSWORD"], ["lms_platform", "LMS_PLATFORM_PASSWORD"]]) {
    const password = process.env[env];
    if (password) await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  }
  console.log("Row-level security applied; role passwords", process.env.LMS_APP_PASSWORD ? "set" : "unchanged");
} finally {
  await client.end();
}
