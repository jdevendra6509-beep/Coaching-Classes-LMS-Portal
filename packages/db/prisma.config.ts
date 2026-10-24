import { defineConfig } from "prisma/config";

// Migrations run as the owner role; the API connects as the RLS-restricted app role.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL_MIGRATE ?? "postgresql://lms:lms@localhost:5432/lms",
  },
});
