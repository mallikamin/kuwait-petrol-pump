-- Monthly Inventory Gain/Loss Migration
-- Version: 1.0
-- Date: 2026-04-17
-- Description: Add monthly_inventory_gain_loss table for month-end fuel adjustments

-- ============================================================
-- STEP 1: Create monthly_inventory_gain_loss table
-- ============================================================

CREATE TABLE "monthly_inventory_gain_loss" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "fuel_type_id" UUID NOT NULL,
  "month" VARCHAR(7) NOT NULL,
  "quantity" DECIMAL(12, 2) NOT NULL,
  "remarks" TEXT,
  "recorded_by" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "monthly_inventory_gain_loss_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monthly_inventory_gain_loss_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_inventory_gain_loss_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_inventory_gain_loss_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "monthly_inventory_gain_loss_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ============================================================
-- STEP 2: Create unique constraint (one entry per branch/fuel/month)
-- ============================================================

CREATE UNIQUE INDEX "unique_branch_fuel_month" ON "monthly_inventory_gain_loss"("branch_id", "fuel_type_id", "month");

-- ============================================================
-- STEP 3: Create performance indexes
-- ============================================================

CREATE INDEX "idx_inv_gain_loss_org_branch_month" ON "monthly_inventory_gain_loss"("organization_id", "branch_id", "month");
CREATE INDEX "idx_inv_gain_loss_month" ON "monthly_inventory_gain_loss"("month");
CREATE INDEX "idx_inv_gain_loss_fuel_month" ON "monthly_inventory_gain_loss"("fuel_type_id", "month");

-- ============================================================
-- STEP 4: Add table/column comments
-- ============================================================

COMMENT ON TABLE "monthly_inventory_gain_loss" IS 'Month-end fuel gain/loss entries for inventory reconciliation. One entry per (branch, fuel_type, month).';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."month" IS 'Month in YYYY-MM format (e.g., 2026-04)';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."quantity" IS 'Gain (+) or loss (-) in liters. Decimal(12,2) for precision.';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."recorded_by" IS 'User who recorded this adjustment';
COMMENT ON COLUMN "monthly_inventory_gain_loss"."recorded_at" IS 'Timestamp when this adjustment was recorded';
