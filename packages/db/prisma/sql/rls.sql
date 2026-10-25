-- Row-level security: defence in depth behind the API's own tenant checks.
-- Run as the owner role after every migration that adds a tenant table (idempotent).
--
-- The API connects as `lms_app` (no BYPASSRLS) and, inside each request's transaction, runs
--   SELECT set_config('app.institute_id', '<uuid from the verified session>', true);
-- `true` = transaction-local, so a pooled connection never carries one tenant's context
-- into another request. With no context set, tenant tables return zero rows.
--
-- Platform-admin endpoints and webhook/worker jobs that span institutes use `lms_platform`,
-- behind separate code paths that only platform admins can reach. It sees every row through
-- an explicit policy rather than the BYPASSRLS attribute, which managed Postgres (e.g. AWS RDS)
-- doesn't let ordinary admins grant.
--
-- The passwords below are for local development only; deployments set real ones right after
-- this script runs (packages/db/scripts/migrate.mjs).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    CREATE ROLE lms_app LOGIN PASSWORD 'lms_app';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_platform') THEN
    CREATE ROLE lms_platform LOGIN PASSWORD 'lms_platform';
  END IF;
  -- Databases set up before the platform_all policies existed gave this role BYPASSRLS.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_platform' AND rolbypassrls) THEN
    ALTER ROLE lms_platform NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO lms_app, lms_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app, lms_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app, lms_platform;

-- Every table with an "instituteId" column gets the same policy.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'instituteId' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_all ON %I', t.table_name);
    EXECUTE format('CREATE POLICY platform_all ON %I TO lms_platform USING (true) WITH CHECK (true)', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO lms_app
         USING ("instituteId" = NULLIF(current_setting(''app.institute_id'', true), '''')::uuid)
         WITH CHECK ("instituteId" = NULLIF(current_setting(''app.institute_id'', true), '''')::uuid)',
      t.table_name);
  END LOOP;
END $$;

-- The ledger is append-only for the application: mistakes are corrected with reversing
-- entries, never by editing history. (The balance rules themselves live in a migration.)
REVOKE UPDATE, DELETE ON "JournalEntry", "JournalLine" FROM lms_app;
