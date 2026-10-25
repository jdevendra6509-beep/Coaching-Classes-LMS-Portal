// Usage: PLATFORM_ADMIN_EMAIL=you@x.in PLATFORM_ADMIN_NAME="You" PLATFORM_ADMIN_PASSWORD=... node dist/scripts/create-platform-admin.js
import "../config/load-env.js";
import { createPrismaClient, UserStatus } from "@lms/db";
import { hashPassword } from "../auth/password.js";

const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.PLATFORM_ADMIN_NAME?.trim() || "Platform Admin";
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const url = process.env.DATABASE_URL_PLATFORM;

if (!email || !password || password.length < 12 || !url) {
  console.error("Set DATABASE_URL_PLATFORM, PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (12+ characters).");
  process.exit(1);
}

const db = createPrismaClient(url);
const passwordHash = await hashPassword(password);
const user = await db.user.upsert({
  where: { email },
  create: { email, name, passwordHash, isPlatformAdmin: true, status: UserStatus.ACTIVE },
  update: { passwordHash, isPlatformAdmin: true, status: UserStatus.ACTIVE },
});
console.log(`Platform admin ready: ${user.email}`);
await db.$disconnect();
