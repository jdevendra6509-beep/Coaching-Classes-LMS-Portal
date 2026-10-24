# Coaching Classes LMS Portal

Multi-tenant SaaS for coaching institutes: subscription billing (Razorpay), students,
teachers, courses, attendance, LMS content, fees & full accounts, and certificates.

Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Data model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma).

## Local setup

Requires Node 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up                       # Postgres, Redis, MinIO, Mailpit
pnpm db:migrate                        # apply Prisma migrations
psql postgresql://lms:lms@localhost:5432/lms -f packages/db/prisma/sql/rls.sql
```
