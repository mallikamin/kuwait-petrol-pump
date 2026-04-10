-- Add shift_id column (nullable first to handle existing data)
ALTER TABLE "backdated_meter_readings" ADD COLUMN "shift_id" UUID;

-- Populate shift_id with the first/default Morning shift for each branch
-- This handles existing meter readings that need a shift context
UPDATE "backdated_meter_readings" bmr
SET "shift_id" = (
    SELECT id FROM "shifts" s
    WHERE s."branchId" = bmr."branch_id"
    AND s.name = 'Morning'
    LIMIT 1
)
WHERE bmr."shift_id" IS NULL;

-- For any rows still without a shift (branch has no Morning shift), use any available shift
UPDATE "backdated_meter_readings" bmr
SET "shift_id" = (
    SELECT id FROM "shifts" s
    WHERE s."branchId" = bmr."branch_id"
    LIMIT 1
)
WHERE bmr."shift_id" IS NULL;

-- Now add the NOT NULL constraint
ALTER TABLE "backdated_meter_readings" ALTER COLUMN "shift_id" SET NOT NULL;

-- Add foreign key constraint
ALTER TABLE "backdated_meter_readings"
ADD CONSTRAINT "backdated_meter_readings_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old unique constraint (if it exists)
DROP INDEX IF EXISTS "unique_branch_date_nozzle_type";

-- Create new unique constraint with shift_id
CREATE UNIQUE INDEX "unique_branch_date_shift_nozzle_type"
    ON "backdated_meter_readings"("branch_id", "business_date", "shift_id", "nozzle_id", "reading_type");

-- Add index for shift-based queries
CREATE INDEX "idx_backdated_meter_shift_date"
    ON "backdated_meter_readings"("shift_id", "business_date");

-- Add comment documenting the shift continuity requirement
COMMENT ON COLUMN "backdated_meter_readings"."shift_id" IS 'Foreign key to shifts table. Required for shift-wise continuity: Morning closing → Evening opening (same day), Evening closing → Next day Morning opening';
