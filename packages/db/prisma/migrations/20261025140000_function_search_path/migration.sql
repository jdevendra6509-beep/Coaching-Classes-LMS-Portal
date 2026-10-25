-- Pin the trigger function's search_path, so it always reads public."JournalLine" whatever the
-- caller's search_path (flagged by Supabase's security advisor; good practice everywhere).
ALTER FUNCTION journal_entry_must_balance() SET search_path = public, pg_temp;
