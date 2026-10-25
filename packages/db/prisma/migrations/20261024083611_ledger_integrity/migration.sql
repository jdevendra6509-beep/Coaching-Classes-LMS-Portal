-- Ledger integrity, enforced by the database regardless of application code.

-- A line is a debit or a credit: exactly one side positive, the other zero.
ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS journal_line_one_side;
ALTER TABLE "JournalLine" ADD CONSTRAINT journal_line_one_side
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));

-- Every journal entry balances. Checked at COMMIT (deferred), after all of the entry's lines exist.
CREATE OR REPLACE FUNCTION journal_entry_must_balance() RETURNS trigger AS $$
DECLARE
  entry uuid := COALESCE(NEW."entryId", OLD."entryId");
  dr numeric;
  cr numeric;
  n int;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*) INTO dr, cr, n
  FROM "JournalLine" WHERE "entryId" = entry;
  IF n > 0 AND (dr <> cr OR n < 2) THEN
    RAISE EXCEPTION 'journal entry % does not balance (debits %, credits %, lines %)', entry, dr, cr, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entry_balanced ON "JournalLine";
CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_must_balance();
