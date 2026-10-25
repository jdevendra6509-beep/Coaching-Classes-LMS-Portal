import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));

/** Recreates lms_test from the migrations and applies RLS, exactly as a deploy would. */
export default async function setup() {
  const env = parseEnv(readFileSync(new URL("../.env.test", import.meta.url), "utf8")) as Record<string, string>;
  const target = new URL(env.DATABASE_URL_MIGRATE);
  const dbName = target.pathname.slice(1);
  const adminUrl = new URL(target);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  execSync("pnpm exec prisma migrate deploy", {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL_MIGRATE: env.DATABASE_URL_MIGRATE },
    stdio: "pipe",
  });

  const db = new pg.Client({ connectionString: env.DATABASE_URL_MIGRATE });
  await db.connect();
  await db.query("SET client_min_messages = warning");
  await db.query(readFileSync(`${dbPackage}/prisma/sql/rls.sql`, "utf8"));
  await db.end();
}
