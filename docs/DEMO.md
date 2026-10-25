# Client demo: Supabase + Render

This is a low-cost setup for showing the product to a client. Supabase holds the database and
the uploaded files. Render runs the two apps from this repository's Dockerfiles. Nothing in the
code is specific to either service, so the same database can later move to a VPS or to AWS
([DEPLOYMENT.md](DEPLOYMENT.md)) with `pg_dump` / `pg_restore`.

```
browser ──► lms-web (Render, Next.js) ──private network──► lms-api (Render, NestJS)
            demo.lms.example.com                              │       │
                                                              ▼       ▼
                                           Supabase Postgres (pooler)  Supabase Storage (S3 API)
```

**Cost:** about $14 a month for two Render Starter services. Supabase, Brevo email and Razorpay
test mode are free. You also need a domain or subdomain you control.

## 1. Supabase

1. **Create a project.** Use a new project (for example `coaching-lms-demo`), in **Southeast
   Asia (Singapore)**, the same region as Render, so every database query stays local.
   Save the database password it asks for.
2. **Choose two more passwords**, one for each of the app's own database roles. Use long random
   strings, letters and digits only, so they need no escaping in URLs. For example, run
   `openssl rand -hex 24` twice.
3. **Copy the connection strings.** In *Connect*, under *Session pooler* and *Transaction
   pooler*, note the host (something like `aws-0-ap-southeast-1.pooler.supabase.com`) and your
   project ref. Build the three URLs:
   ```
   DATABASE_URL_MIGRATE   postgresql://postgres.<ref>:<db-password>@<pooler-host>:5432/postgres?sslmode=require
   DATABASE_URL           postgresql://lms_app.<ref>:<app-password>@<pooler-host>:6543/postgres?sslmode=require
   DATABASE_URL_PLATFORM  postgresql://lms_platform.<ref>:<platform-password>@<pooler-host>:6543/postgres?sslmode=require
   ```
   The `lms_app` and `lms_platform` roles are created in the next step.
4. **Create the database.** Open
   [`packages/db/supabase/setup.sql`](../packages/db/supabase/setup.sql) and replace
   `CHANGE_ME_APP_PASSWORD` and `CHANGE_ME_PLATFORM_PASSWORD` at the top with the two passwords
   from step 2. Paste the whole file into *SQL Editor → New query* and press *Run*. It creates
   every table, the row-level security policies, the two roles and the `lms-files` storage
   bucket, all in one transaction. The final query lists every migration and both roles. You
   can also skip this step: the first Render deploy does the same through its migration step.
5. **Download the CA certificate.** Go to *Database → Settings → SSL Configuration → Download
   certificate*. It is needed in step 2.4.
6. **Check the storage bucket.** The script created a private bucket named `lms-files`. If you
   skipped the script, create it in *Storage* and keep it **private**.
7. **Create S3 access keys.** In *Storage → Settings → S3 Connection*, enable the connection.
   Note the endpoint and region, then create an access key and note the key ID and secret.
8. **Turn off the Data API.** In *Project Settings → Data API*, turn it off. The app never uses
   it. The migration also revokes the `anon` and `authenticated` roles' access to every table,
   so the public anon key can't read anything even if the Data API is on.

## 2. Render

1. Sign up at [render.com](https://render.com) with GitHub, and give it access to this repository.
2. Choose *New → Blueprint* and pick this repository. Render reads [`render.yaml`](../render.yaml)
   and creates `lms-api` and `lms-web`. It shows these Render settings in the dashboard as
   "environment variables".
3. Fill in the values it asks for:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL`, `DATABASE_URL_PLATFORM`, `DATABASE_URL_MIGRATE` | the three URLs from step 1.3 |
   | `PLATFORM_HOST` (on both services) | your demo host, e.g. `lms.example.com` |
   | `PLATFORM_URL` | `https://lms.example.com` |
   | `APP_URL_TEMPLATE` | `https://{slug}.lms.example.com` |
   | `CORS_ORIGINS` | `https://lms.example.com` |
   | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | from step 1.7 |
   | `SMTP_URL`, `MAIL_FROM` | see *Email* below |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay **test mode** keys |

4. **Add the CA certificate.** On `lms-api`, open *Environment → Secret Files* and add a file
   named `supabase-ca.crt` with the contents of the certificate from step 1.5.
5. **Deploy.** Every deploy first runs the database migration, then starts the new version. A
   failed migration stops the deploy. After that, Render redeploys each time `main` passes CI.

> If a deploy fails with `self-signed certificate in certificate chain`, check the secret file
> from step 2.4. As a stopgap for the demo only, you can add `&uselibpqcompat=true` to the three
> URLs. Traffic stays encrypted, but the server's certificate isn't verified.

## 3. Domain

Institutes live on subdomains, so you need a wildcard domain. A subdomain of a domain you
already own works, and you don't have to change name servers:

1. **Add the domains in Render.** On `lms-web`, open *Settings → Custom Domains* and add
   `lms.example.com` and `*.lms.example.com`.
2. **Create the DNS records** Render shows at your DNS provider:
   - a CNAME for `lms` and one for `*.lms`, both pointing at `lms-web.onrender.com`;
   - for the wildcard, also the `_acme-challenge` CNAME, so Render can issue the certificate.
3. **Wait for the certificates.** Render shows them as issued within a few minutes of DNS
   updating.

The API keeps its own address, `https://lms-api.onrender.com`. It is used only for Razorpay's
webhook: `https://lms-api.onrender.com/webhooks/razorpay`.

## 4. Email

Any SMTP service works. [Brevo](https://www.brevo.com)'s free plan sends 300 emails a day:

1. **Create the SMTP key.** In Brevo, create an SMTP key and verify your sender address (or
   domain).
2. **Set `SMTP_URL`.** Use `smtp://<brevo-login>:<smtp-key>@smtp-relay.brevo.com:587`. The
   connection is upgraded to TLS automatically. URL-encode any `@` in the login as `%40`.
3. **Set `MAIL_FROM`.** For example, `Coaching LMS <no-reply@example.com>`, using the sender you
   verified.

## 5. First sign-in and demo data

Open *lms-api → Shell* in Render. Then:

```bash
# Your platform admin (change the password after first sign-in, then enable 2FA)
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='a-long-password' \
  node dist/scripts/create-platform-admin.js

# Optional: the demo institute "Bright Future Academy" with teachers, students, fees and
# attendance. Every demo user's password is demo-password-123.
NODE_ENV=development node dist/scripts/seed-demo.js
```

The demo institute is then at `https://demo.lms.example.com`. Sign-ins are listed in the
[README](../README.md#local-setup). The demo users have made-up `@demo.test` addresses, so their
invite emails fail to send. That is harmless. Before the demo, create the real plans in the
platform console. The seeded plans aren't linked to Razorpay, so a live signup can't use them.

## 6. Before showing it

- **Sign up a test institute end to end** with Razorpay test mode. Use a test card or UPI ID
  `success@razorpay`. Then point Razorpay's webhook at the URL above.
- **Upload and download a course file**, to confirm storage, the CORS setup and file sizes
  (up to 50 MB on Supabase's free plan).
- **Check the audit IP.** Sign in as the institute admin and check that the audit log shows your
  own IP address, not Render's.
- **Keep the project active.** Supabase pauses free projects after a week without activity. Open
  the demo a day before the meeting, or upgrade the project.

## 7. Moving on after approval

- **Database:** `pg_dump` the Supabase database and restore it on the new server. Then run
  `node packages/db/scripts/migrate.mjs` against it, which re-creates roles, grants and
  policies.
- **Files:** copy the files from the `lms-files` bucket with any S3 tool (`aws s3 sync` with
  the Supabase endpoint), then point `S3_*` at the new storage.
- **Removing the demo hosting:** delete the Render services and remove `render.yaml`. The AWS
  path is in [DEPLOYMENT.md](DEPLOYMENT.md). It stays inactive until the
  `AWS_DEPLOY_ROLE_ARN` repository variable is set.
