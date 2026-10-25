# Coaching Classes LMS Portal

Multi-tenant SaaS for coaching institutes: subscription billing (Razorpay), students,
teachers, courses, attendance, LMS content, fees & full accounts, and certificates.

- Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Data model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)
- API: [apps/api](apps/api) (NestJS 12, ESM). OpenAPI UI at `/docs` outside production.
- Web: [apps/web](apps/web) (Next.js 16, React 19, Tailwind 4). One app serves the platform site and every institute subdomain.
- Demo hosting: Supabase (Postgres + storage) and Render, from [render.yaml](render.yaml); guide in [docs/DEMO.md](docs/DEMO.md).
- Production hosting (later): AWS Mumbai (ECS Fargate, RDS, S3, SES) via Terraform in [infrastructure/terraform](infrastructure/terraform); runbook in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Local setup

Requires Node 22+, pnpm 10, and Docker (or a local PostgreSQL 16+).

```bash
pnpm install
cp .env.example .env                        # set ENCRYPTION_KEY: openssl rand -base64 32
cp apps/web/.env.example apps/web/.env.local
pnpm services:up                            # Postgres, Redis, MinIO, Mailpit (mail UI on :8025)
pnpm db:migrate                             # Prisma migrations
psql postgresql://lms:lms@localhost:5432/lms -f packages/db/prisma/sql/rls.sql

pnpm --filter @lms/api build
pnpm --filter @lms/api seed:demo            # demo institute, people, fees, attendance
pnpm dev                                    # API on :4000, web on :3000
```

Then open:

| Site | URL | Sign in as (password `demo-password-123`) |
|---|---|---|
| Platform site and console | http://localhost:3000 | `platform@demo.test` |
| Demo institute | http://demo.localhost:3000 | `admin@demo.test`, `accounts@demo.test`, `meera@demo.test` (teacher), `aarav@demo.test` (student) |

Browsers resolve `*.localhost` to your machine, so every institute gets its own subdomain
locally with no DNS setup. No Docker? Use a local PostgreSQL, set `STORAGE_DRIVER=local`
(files on disk), and emails are logged as failed sends instead of reaching Mailpit.

To create your own platform admin instead of the demo one:
`PLATFORM_ADMIN_EMAIL=you@example.in PLATFORM_ADMIN_PASSWORD='a-long-password' pnpm --filter @lms/api create-platform-admin`.

Run `rls.sql` again after any migration that adds a table (it is idempotent).

## Tests

```bash
pnpm --filter @lms/api test             # needs Postgres on localhost:5432 (user lms / lms)
```

The suite recreates an `lms_test` database from the migrations, applies RLS, and runs
unit tests plus end-to-end tests over HTTP: auth, tenant isolation, roles, Razorpay
onboarding and webhooks, people, CSV import, courses, batches, enrollments, attendance, course files, fees and accounts, certificates and PDFs.
Razorpay, email and object storage are faked; the database is real. The S3 URL signing
itself is unit-tested with the real AWS SDK (offline).

## API overview

| Area | Routes |
|---|---|
| Auth | `POST /auth/login` · `refresh` · `logout` · `GET /auth/me` · `POST /auth/invite/accept` · `password/forgot` · `password/reset` · `mfa/setup` · `mfa/enable` · `mfa/disable` |
| Public signup | `GET /plans` · `GET /signup/slug-available` · `POST /signup` |
| Webhooks | `POST /webhooks/razorpay` (signature-verified, idempotent) |
| Platform admin | `GET /platform/institutes[/:id]` · `POST /platform/institutes/:id/suspend` · `reactivate` · `resend-welcome` · `GET /platform/payments` · `GET/POST /platform/plans` · `PATCH /platform/plans/:id` |
| Institute | `GET/PATCH /institute` · `GET /institute/members` · `POST /staff` · `POST /staff/:membershipId/deactivate` · `activate` |
| Teachers | `GET/POST /teachers` · `GET/PATCH /teachers/:id` · `POST /teachers/:id/deactivate` · `activate` · `resend-invite` |
| Students | `GET/POST /students` · `POST /students/import` (CSV, `dryRun`) · `GET/PATCH /students/:id` · `deactivate` · `activate` · `resend-invite` · `GET /students/:id/attendance` |
| Courses | `GET/POST /courses` · `GET/PATCH/DELETE /courses/:id` |
| Batches | `GET/POST /batches` · `GET/PATCH/DELETE /batches/:id` · `PUT /batches/:id/teachers` · `GET /batches/:id/students` · `POST /batches/:id/enrollments` |
| Enrollments | `POST /enrollments` · `POST /enrollments/:id/drop` · `complete` · `reopen` |
| Attendance | `GET /batches/:id/attendance` · `GET/PUT /batches/:id/attendance/:date` |
| Course content | `GET /courses/:id/materials` · `POST /courses/:id/materials/upload-url` · `POST /courses/:id/materials` · `PUT /courses/:id/materials/order` · `PATCH/DELETE /materials/:id` · `GET /materials/:id/download` · `POST /courses/:id/modules` · `PUT /courses/:id/modules/order` · `PATCH/DELETE /modules/:id` |
| Branding & storage | `GET /public/institutes/:slug` · `POST /institute/logo/upload-url` · `POST /institute/logo` · `GET /institute/storage` |
| Fees (AR) | `GET/POST /invoices` · `POST /invoices/from-enrollment` · `GET/DELETE /invoices/:id` · `POST /invoices/:id/issue` · `void` · `POST /invoices/:id/payments` · `GET /payments` · `GET /payments/:id/receipt` · `POST /payments/:id/reverse` · `GET /students/:id/fees` · `GET/POST /discounts` · `PATCH /discounts/:id` |
| Payables (AP) | `GET/POST /vendors` · `PATCH /vendors/:id` · `GET/POST /bills` · `GET /bills/:id` · `POST /bills/:id/payments` · `POST /bills/:id/void` |
| Ledger | `GET/POST /accounts` · `PATCH /accounts/:id` · `GET /accounts/:id/ledger` · `GET/POST /journals` · `POST /journals/:id/reverse` |
| Reports | `GET /reports/trial-balance` · `profit-and-loss` · `balance-sheet` · `receivables-ageing` · `payables-ageing` · `collections` |
| Certificates | `POST /certificate-templates/upload-url` · `GET/POST /certificate-templates` · `GET/PATCH/DELETE /certificate-templates/:id` · `GET /certificate-templates/:id/preview` · `PUT /courses/:id/certificate-template` · `GET /enrollments/:id/certificate-status` · `POST /enrollments/:id/certificate` · `GET /certificates` · `GET /certificates/:id/download` · `POST /certificates/:id/resend` · `revoke` · `GET /public/certificates/:code` |
| PDFs | `GET /invoices/:id/pdf` · `GET /payments/:id/receipt.pdf` |
| Student portal | `GET /me/profile` · `GET /me/enrollments` · `GET /me/attendance` · `GET /me/courses/:id/materials` · `GET /me/materials/:id/download` · `GET /me/fees` · `GET /me/payments/:id/receipt[.pdf]` · `GET /me/invoices/:id/pdf` · `GET /me/certificates` · `GET /me/certificates/:id/download` |
| Health | `GET /health` · `GET /health/ready` |

### Razorpay setup
1. Create API keys (test mode first) → `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Add a webhook pointing at `https://api.<your-domain>/webhooks/razorpay` with a secret
   (`RAZORPAY_WEBHOOK_SECRET`) and the events `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`, `subscription.resumed`.
3. Create plans from the platform console (`POST /platform/plans`); the API creates the
   matching Razorpay plan with GST included.

### Student CSV import
Header row required; `name` and `email` are mandatory. Recognised columns (case and
spacing don't matter): `phone`/`mobile`, `admission no`, `dob`/`date of birth`
(YYYY-MM-DD), `guardian name`/`parent name`, `guardian phone`/`parent phone`,
`guardian email`/`parent email`, `address`, `batch` (batch name; enrolls the student).
Admission numbers are generated (ADM-00001…) when blank. The import is all-or-nothing:
send `dryRun: true` first to get every problem with its line number.

### Course files
Uploads go straight from the browser to storage, never through the API:

1. `POST /courses/:id/materials/upload-url` with `{ fileName, mimeType, sizeBytes }` → the
   API checks type, size and the plan's storage quota and returns `uploadUrl` + `uploadToken`.
2. The browser `PUT`s the file to `uploadUrl` with the returned `Content-Type` header. The
   URL is valid for 15 minutes and only for exactly that size and type.
3. `POST /courses/:id/materials` with `{ title, uploadToken }` → the API checks the object
   arrived and matches, then saves the material (unpublished unless `isPublished: true`).

Downloads return a URL that works for 5 minutes, issued only after checking the student is
enrolled (active or completed) and the material is published. Allowed: PDF, Word, Excel,
PowerPoint, text/CSV, PNG/JPEG/WebP (20 MB), MP4/WebM, MP3; size cap `MAX_UPLOAD_MB`.

**Bucket setup on AWS:** keep "Block all public access" on; add a CORS rule allowing `PUT`
and `GET` from `https://*.<your-domain>` with header `Content-Type`; enable
[GuardDuty Malware Protection for S3](https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html)
on the bucket to scan uploads. Locally, `pnpm services:up` creates the `lms-private`
bucket in MinIO.

### Fees and accounts
Every money document posts a balanced double-entry journal automatically:

| Event | Debit | Credit |
|---|---|---|
| Invoice issued | Accounts Receivable (total) | Fee Income (after discounts), GST Payable (tax) |
| Fee received | Cash in Hand (cash) or Bank (others), or a chosen asset account | Accounts Receivable |
| Vendor bill | the bill's expense account | Accounts Payable |
| Bill paid | Accounts Payable | Cash / Bank |

Voiding an invoice or bill, or reversing a payment (bounced cheque), posts the mirror-image
entry; nothing in the ledger is ever edited or deleted. The database enforces this too:
every entry must balance at commit, and the app's database role has no UPDATE/DELETE on
journal tables. Invoice, receipt and admission numbers are gap-free per institute.
Discounts reduce the taxable value before GST. Instalment plans age by their own due dates.

Receipts and invoices are also available as PDFs; the receipt PDF is attached to the receipt email.

Not yet: CGST/SGST vs IGST split on invoices, period locking (closing a month), online fee
collection.

### Certificates
1. Upload a background design (PDF, PNG or JPEG) via `POST /certificate-templates/upload-url`
   and create the template with its fields. Check the layout with `GET …/preview`, which
   fills it with deliberately long sample values.
2. Assign it to a course: `PUT /courses/:id/certificate-template`.
3. A certificate is issued automatically the moment **both** hold: the teacher has marked the
   enrollment complete, and every invoice for that enrollment is paid in full (a course with a
   fee must have been invoiced). Whichever happens last triggers it. The PDF is emailed to the
   student and guardian; `GET /enrollments/:id/certificate-status` explains what's missing.

Each field is either a value (`key`) or fixed text with placeholders (`text`):

```json
{ "key": "studentName", "x": 421, "y": 280, "fontSize": 32, "font": "Times-Bold", "align": "center", "maxWidth": 600 }
{ "text": "has completed {courseName} on {completionDate}", "x": 421, "y": 330, "dateFormat": "D MMMM YYYY", "align": "center" }
{ "key": "verificationQr", "x": 720, "y": 460, "size": 90 }
```

Keys: `studentName`, `admissionNo`, `courseName`, `courseCode`, `batchName`, `durationWeeks`,
`completionDate`, `issueDate`, `serialNo`, `instituteName`, `teacherName`, `verificationUrl`,
`verificationCode`, `verificationQr`. Coordinates are PDF points from the top-left corner
(A4 landscape is 842 × 595); `y` is the text baseline, or the QR code's top edge. Fonts:
Helvetica, Times and Courier families. Text shrinks to `maxWidth` for long names.

What's printed is frozen at issue time; `GET /public/certificates/:code` (behind the QR code)
confirms a certificate is genuine and not revoked. Issued certificates can't be "un-completed";
revoke them instead. The standard PDF fonts cover Latin script only: accents are folded and
other scripts (e.g. Devanagari) are left out until custom fonts are supported.
