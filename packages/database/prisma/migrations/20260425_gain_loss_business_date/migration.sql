-- Gain/Loss schema upgrade: monthly -> calendar-date keyed
-- Version: 1.1
-- Date: 2026-04-25
-- Description:
--   1. Add `business_date DATE` so gain/loss can be recorded on any date
--      (weekly, biweekly, monthly per accountant preference).
--   2. Capture the last purchase rate at the time of recording so the
--      computed value (qty x rate) is auditable and immune to later
--      purchase price changes.
--   3. Capture the measured liters and the system's book stock at the
--      date of recording so the entry is self-contained for audit.
--   4. Swap the unique key from (branch, fuel, month) to
--      (branch, fuel, business_date).

-- ============================================================
-- STEP 1: New columns
-- ============================================================

ALTER TABLE "monthly_inventory_gain_loss"
  ADD COLUMN "business_date" DATE,
  ADD COLUMN "measured_qty" DECIMAL(14, 3),
  ADD COLUMN "book_qty_at_date" DECIMAL(14, 3),
  ADD COLUMN "last_purchase_rate" DECIMAL(12, 4),
  ADD COLUMN "value_at_rate" DECIMAL(14, 2);

-- ============================================================
-- STEP 2: Backfill business_date from month (first day of month)
-- ============================================================

UPDATE "monthly_inventory_gain_loss"
SET "business_date" = TO_DATE("month" || '-01', 'YYYY-MM-DD')
WHERE "business_date" IS NULL;

-- ============================================================
-- STEP 3: Lock business_date NOT NULL going forward
-- ============================================================

ALTER TABLE "monthly_inventory_gain_loss"
  ALTER COLUMN "business_date" SET NOT NULL;

-- ============================================================
-- STEP 4: Swap unique constraint
--   Drop legacy month-based uniqueness, add date-based.
--   Keep `month` column for backward-compat with existing report
--   logic; it stays in sync via the application layer.
-- ============================================================

DROP INDEX IF EXISTS "unique_branch_fuel_month";

CREATE UNIQUE INDEX "unique_branch_fuel_business_date"
  ON "monthly_inventory_gain_loss"("branch_id", "fuel_type_id", "business_date");

-- ============================================================
-- STEP 5: Helper indexes for the new lookup paths
-- ============================================================

CREATE INDEX IF NOT EXISTS "idx_inv_gain_loss_business_date"
  ON "monthly_inventory_gain_loss"("business_date");

CREATE INDEX IF NOT EXISTS "idx_inv_gain_loss_branch_business_date"
  ON "monthly_inventory_gain_loss"("branch_id", "business_date");

-- ============================================================
-- STEP 6: Column comments
-- ============================================================

COMMENT ON COLUMN "monthly_inventory_gain_loss"."business_date" IS 'Calendar date when gain/loss was measured. Authoritative; month is derived.';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."measured_qty" IS 'Liters physically measured by accountant (dipstick / tank gauge).';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."book_qty_at_date" IS 'System book stock at business_date when this entry was created. Audit snapshot.';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."last_purchase_rate" IS 'Most recent purchase cost per liter at business_date. Used to value the gain/loss.';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."value_at_rate" IS 'Gain/loss valuation = quantity * last_purchase_rate. Immutable once recorded.';
