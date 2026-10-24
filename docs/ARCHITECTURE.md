# Architecture & decisions

Multi-tenant SaaS: one platform, many coaching institutes, each with its own admins,
accountants, teachers and students. Institutes pay the platform a monthly subscription
in advance via Razorpay.

## 1. Stack — what we keep, what we change

Your proposed stack is sound. It's kept almost entirely; the changes below cut cost and
moving parts for v1 without closing any doors.

| Area | Proposal | Decision | Why |
|---|---|---|---|
| Web | Next.js + TS + Tailwind + shadcn/ui | **Keep** (Next 16, App Router) | One app serves the platform admin, institute dashboards and student portal, routed by subdomain. |
| API | NestJS + TS | **Keep** (NestJS 11, modular monolith) | Guards/interceptors suit per-request tenant context; OpenAPI generates a typed client for the web app. |
| DB | PostgreSQL + Prisma | **Keep** (PG 16+, Prisma 7) | Composite FKs + RLS already proven on this schema (see §3). |
| Auth | Amazon Cognito | **Change → in-house auth in NestJS** | Roles and memberships are per-institute and already live in our DB; Cognito would duplicate them and bill per active user. Argon2id passwords, short-lived JWT access token + rotating refresh token in httpOnly cookies, TOTP MFA for admins, login throttling. Can still be swapped for a managed IdP later because identity sits behind one module. |
| Jobs | Redis + background jobs | **Keep, with BullMQ** | Emails, certificate PDFs, report exports, subscription renewal checks. The `worker` app shares code with `api`. |
| Files | S3 + CDN | **Keep** (S3 Mumbai, presigned URLs) | Students never get a permanent link: API checks the enrollment, then issues a URL that expires in ~5 min. MinIO locally. |
| Email | "Transactional provider" | **Amazon SES (ap-south-1)** | Cheap, same AWS account; Mailpit locally. |
| PDFs | — | **pdf-lib in the worker** | Certificates are drawn on the institute's uploaded background at the mapped coordinates. |
| Payments | Razorpay | **Keep** — Subscriptions API for the platform | See §5. |
| Infra | ECS Fargate, RDS, ElastiCache, CloudFront, WAF, Terraform | **Keep, but phase it** | Launch with: ECS Fargate (web, api, worker), RDS single-AZ + automated backups, ElastiCache small node, S3, SES, CloudFront. Add Multi-AZ, WAF rules and read replicas when paying customers justify it. Terraform from day one is still worth it. |
| Video / live classes, exams, WhatsApp, SMS | various | **Out of v1** | Not in your 6-step flow. v1 supports video as uploaded files or external links (YouTube unlisted/Vimeo); add a video provider and the exam engine in phase 2. |
| Monorepo | pnpm + Turborepo | **Keep** | Already set up in this repo. |

## 2. Repository layout

```
apps/
  web/        Next.js — platform admin, institute portal, student portal
  api/        NestJS — REST API, Razorpay webhooks
  worker/     BullMQ consumers (email, certificate PDFs, renewals, reports)
packages/
  db/         Prisma schema, migrations, RLS script   ← done
  api-client/ generated from the API's OpenAPI spec
  ui/         shared shadcn components
  config/     eslint / tsconfig presets
docker-compose.yml   Postgres, Redis, MinIO, Mailpit for local dev
```

## 3. Tenancy

- Shared database, shared tables, `instituteId` on every institute-owned row.
- **Tenant comes from the server, never the browser.** Requests arrive on
  `<slug>.platform.in`; the API resolves the slug, then checks the logged-in user has an
  active `Membership` in that institute. The session token carries `instituteId` +
  `membershipId` + `role`.
- **Composite foreign keys**: e.g. `Enrollment(instituteId, batchId) → Batch(instituteId, id)`.
  An enrollment of institute A *cannot* reference a batch of institute B — the database
  rejects it. Enrollment → Batch even includes `courseId`, so a batch of a different
  course can't be attached either.
- **Row-level security** (`packages/db/prisma/sql/rls.sql`): the API connects as
  `lms_app`, which only sees rows whose `instituteId` equals the transaction-local
  `app.institute_id`. With no context set, tenant tables return nothing. Platform-admin
  screens and webhooks use a separate `lms_platform` role behind platform-only routes.
- Verified locally: no context → 0 rows; institute A sees only A; writing a B row while
  acting as A fails; context does not survive the transaction; cross-tenant FK rejected.
- A `tests/tenant-isolation` suite will hit every endpoint as institute A asking for B's
  ids and expect 404.

## 4. Roles

| Role | Can |
|---|---|
| Platform admin (you) | Manage institutes, plans, subscriptions, suspend/reactivate, view platform payments. No access to institute data except a logged, time-boxed "support access". |
| Institute admin | Institute profile, teachers, students, courses, batches, materials, certificates, discounts, all accounts. |
| Accountant | Fees, discounts, AP/AR, ledger, reports. |
| Teacher | Assigned batches only: attendance, upload materials, mark enrollment complete. |
| Student | Own profile, materials of enrolled courses, attendance, invoices/receipts, certificates. |

A user is a global identity (`User`) and can hold memberships in several institutes
(e.g. a teacher who teaches at two places) with one email and password.

## 5. Flows

### 5.1 Institute onboarding & subscription (Razorpay)
1. Public signup form → `Institute(status=PENDING_PAYMENT)` + chosen `Plan`.
2. API creates a Razorpay **Subscription** (plan with monthly period) and returns its id;
   the browser opens Razorpay Checkout to authorise the first payment + UPI Autopay /
   card / e-mandate for renewals.
3. Razorpay webhook `subscription.activated` / `subscription.charged` → stored in
   `WebhookEvent` (unique on event id = idempotent) → signature verified →
   `PlatformPayment` captured → `Subscription.currentPeriodEnd` extended by a month →
   institute `ACTIVE`. **The browser redirect is never treated as proof of payment.**
4. On first activation: create the owner `User` + `INSTITUTE_ADMIN` membership, seed the
   chart of accounts and number sequences, email a one-time "set your password" link.
5. `subscription.halted` / failed charge → `PAST_DUE`, banner + email; after the grace
   period (configurable, e.g. 7 days) the institute becomes read-only; you can suspend
   or reactivate manually from the platform admin.
6. Fallback for institutes that won't set up autopay: a monthly Razorpay payment link,
   same webhook path.

### 5.2 Students & content
Institute admin creates students (single form + CSV import) → each gets a `User` +
`STUDENT` membership + invite email. Admin creates course → batches → enrolls students.
Teachers/admins upload materials per course (optionally grouped into modules) directly
to S3 via presigned upload. A student sees published materials of every course they
have an `ACTIVE` or `COMPLETED` enrollment in.

### 5.3 Fees, discounts & accounts
- Enrollment can auto-generate a `StudentInvoice` from the course fee (one-time or
  instalments). Discounts are rules (percent/flat, per course or global, date-bounded)
  or ad-hoc; the applied amount is snapshotted on the invoice.
- Payments are recorded with method (cash/UPI/bank/cheque) and produce a numbered receipt.
- **Double-entry ledger**: every invoice, receipt, vendor bill and bill payment posts a
  balanced journal entry automatically:
  - Invoice: Dr Accounts Receivable / Cr Fee Income (+ Cr GST Payable)
  - Receipt: Dr Cash/Bank / Cr Accounts Receivable
  - Vendor bill: Dr Expense / Cr Accounts Payable
  - Bill payment: Dr Accounts Payable / Cr Cash/Bank
  - Manual journals for salaries, rent, adjustments.
- Reports: AR ageing, outstanding fees by student/batch, AP ageing, cash book, day book,
  trial balance, P&L, balance sheet, GST summary. Export to CSV/Excel.

### 5.4 Certificates
1. Admin uploads a background (PDF/PNG) and places fields on it in a drag-and-drop
   editor: student name, course, batch, completion date, serial no., grade, QR to a
   public verification page. Stored as JSON coordinates on `CertificateTemplate`.
2. Teacher marks an enrollment **COMPLETED**.
3. On that event, and on every payment, the system checks: enrollment completed **and**
   all of its invoices `PAID`. When both hold, a job renders the PDF, stores it, creates
   `Certificate`, and emails it to the student (and guardian email if present).
4. Student can download/print it from the portal; anyone can verify it at
   `/verify/<code>`.

## 6. Security baseline
Argon2id; MFA for admins; rate-limited login; RBAC guard on every route plus RLS;
presigned short-lived file URLs; Razorpay signature verification; audit log for
admin, financial and permission changes; no PII or tokens in logs; separate secrets per
environment (AWS Secrets Manager); daily backups with a tested restore. Get the DPDP Act
obligations (especially for minors' data and parental consent) reviewed by an Indian
privacy lawyer before onboarding paying institutes.

## 7. Build plan

| Milestone | Scope |
|---|---|
| **M0 Foundation** ✅ backend | Monorepo, local services, data model, RLS, NestJS API with tenant context, auth (sessions, invites, reset, TOTP MFA), CI. Remaining: Next.js shell with subdomain routing. |
| **M1 Platform & billing** ✅ backend | Institute signup, plans, Razorpay subscriptions + webhooks, platform admin console, welcome email. Remaining: UI, worker jobs (grace-period expiry, pending-signup cleanup), platform GST invoices. |
| **M2 Institute core** ✅ backend | Profile, staff, teachers, students (CSV import), courses, batches, enrollments, attendance, student portal views. Remaining: logo upload (comes with file storage in M3), UI. |
| **M3 LMS** | Material upload/organisation, student portal to view/download. |
| **M4 Fees & accounts** | Invoices, discounts, receipts, AP (vendors, bills), ledger, reports. |
| **M5 Certificates** | Template editor, completion + fee gating, PDF generation, email, verification page. |
| **M6 Hardening & launch** | Tenant-isolation and e2e tests, load test, backups/restore drill, Terraform for AWS Mumbai, monitoring (Sentry + CloudWatch). |

## 8. Decisions

The defaults below were confirmed.

1. **Student fees online?** Default: institutes *record* fees (cash/UPI/bank) in v1.
   Online student payments would need either each institute's own Razorpay keys or
   Razorpay Route (platform as marketplace) — decide before M4.
2. **GST**: does the platform charge 18% GST on subscriptions, and do institutes need
   GST-compliant fee invoices? Default: yes to both, configurable per institute.
3. **Plans**: tiers by number of students and storage? Default: 2–3 tiers, limits
   enforced softly (warning) then hard.
4. **Free trial?** Default: none, since you asked for advance payment.
5. **Custom domains** for institutes: default later; subdomains in v1.
