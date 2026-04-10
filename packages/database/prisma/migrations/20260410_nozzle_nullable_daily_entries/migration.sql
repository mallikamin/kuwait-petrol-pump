-- Make nozzleId nullable on BackdatedEntry (daily entries don't have nozzle assignment)
ALTER TABLE backdated_entries
ALTER COLUMN nozzle_id DROP NOT NULL;

-- Remove prior uniqueness definitions if present.
ALTER TABLE backdated_entries
DROP CONSTRAINT IF EXISTS unique_nozzle_date_shift;
ALTER TABLE backdated_entries
DROP CONSTRAINT IF EXISTS unique_daily_entry_per_branch;
DROP INDEX IF EXISTS unique_nozzle_date_shift;
DROP INDEX IF EXISTS unique_daily_entry_per_branch;

-- Partial unique indexes are required for conditional uniqueness in PostgreSQL.
-- 1) Legacy nozzle-linked entries: unique per (nozzle_id, business_date, shift_id)
--    only when nozzle_id is present.
CREATE UNIQUE INDEX IF NOT EXISTS unique_nozzle_date_shift
ON backdated_entries (nozzle_id, business_date, shift_id)
WHERE nozzle_id IS NOT NULL;

-- 2) Daily non-nozzle entries: one per (branch_id, business_date, shift_id)
--    only when nozzle_id is absent.
CREATE UNIQUE INDEX IF NOT EXISTS unique_daily_entry_per_branch
ON backdated_entries (branch_id, business_date, shift_id)
WHERE nozzle_id IS NULL;
