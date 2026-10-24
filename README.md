# Coaching Classes LMS Portal

Multi-tenant SaaS for coaching institutes: subscription billing (Razorpay), students,
teachers, courses, attendance, LMS content, fees & full accounts, and certificates.

- Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Data model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)
- API: [apps/api](apps/api) (NestJS 12, ESM). OpenAPI UI at `/docs` outside production.

## Local setup

Requires Node 22+, pnpm 10, Docker (or a local PostgreSQL 16+).

```bash
pnpm install
cp .env.example .env                    # fill ENCRYPTION_KEY: openssl rand -base64 32
pnpm services:up                        # Postgres, Redis, MinIO, Mailpit (UI on :8025)
pnpm db:migrate                         # apply Prisma migrations
psql postgresql://lms:lms@localhost:5432/lms -f packages/db/prisma/sql/rls.sql

pnpm --filter @lms/api build
set -a; . ./.env; set +a
PLATFORM_ADMIN_EMAIL=you@example.in PLATFORM_ADMIN_PASSWORD='a-long-password' \
  pnpm --filter @lms/api create-platform-admin
pnpm --filter @lms/api dev              # http://localhost:4000, docs at /docs
```

`*.lvh.me` resolves to 127.0.0.1, so `http://alpha.lvh.me:4000` addresses institute
`alpha` locally. API clients can send `X-Institute-Slug: alpha` instead.

Run `rls.sql` again after any migration that adds a table (it is idempotent).

## Tests

```bash
pnpm --filter @lms/api test             # needs Postgres on localhost:5432 (user lms / lms)
```

The suite recreates an `lms_test` database from the migrations, applies RLS, and runs
unit tests plus end-to-end tests over HTTP: auth, tenant isolation, roles, Razorpay
onboarding and webhooks. Razorpay and email are faked; the database is real.

## API overview

| Area | Routes |
|---|---|
| Auth | `POST /auth/login` · `refresh` · `logout` · `GET /auth/me` · `POST /auth/invite/accept` · `password/forgot` · `password/reset` · `mfa/setup` · `mfa/enable` · `mfa/disable` |
| Public signup | `GET /plans` · `GET /signup/slug-available` · `POST /signup` |
| Webhooks | `POST /webhooks/razorpay` (signature-verified, idempotent) |
| Platform admin | `GET /platform/institutes[/:id]` · `POST /platform/institutes/:id/suspend` · `reactivate` · `resend-welcome` · `GET /platform/payments` · `GET/POST /platform/plans` · `PATCH /platform/plans/:id` |
| Institute | `GET/PATCH /institute` · `GET /institute/members` |
| Health | `GET /health` · `GET /health/ready` |

### Razorpay setup
1. Create API keys (test mode first) → `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Add a webhook pointing at `https://api.<your-domain>/webhooks/razorpay` with a secret
   (`RAZORPAY_WEBHOOK_SECRET`) and the events `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`, `subscription.resumed`.
3. Create plans from the platform console (`POST /platform/plans`); the API creates the
   matching Razorpay plan with GST included.
