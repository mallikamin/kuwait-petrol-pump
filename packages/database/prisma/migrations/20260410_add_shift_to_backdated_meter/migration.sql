-- Add shift_id column to backdated_meter_readings (clean migration, no existing data)
ALTER TABLE "backdated_meter_readings" ADD COLUMN "shift_id" UUID NOT NULL;

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
