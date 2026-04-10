-- Make nozzleId nullable on BackdatedEntry (daily entries don't have nozzle assignment)
ALTER TABLE backdated_entries ALTER COLUMN nozzle_id DROP NOT NULL;

-- Drop old nozzle-only unique constraint (allows multiple entries when nozzleId=NULL)
ALTER TABLE backdated_entries DROP CONSTRAINT unique_nozzle_date_shift;

-- Add back nozzle-based UNIQUE constraint (only for entries with nozzleId)
ALTER TABLE backdated_entries
ADD CONSTRAINT unique_nozzle_date_shift UNIQUE (nozzle_id, business_date, shift_id) WHERE nozzle_id IS NOT NULL;

-- Add new UNIQUE constraint for daily entries (one per branch, date, shift combo when nozzleId is NULL)
ALTER TABLE backdated_entries
ADD CONSTRAINT unique_daily_entry_per_branch UNIQUE (branch_id, business_date, shift_id) WHERE nozzle_id IS NULL;
