-- Inventory Bootstrap Migration
-- Version: 1.0
-- Date: 2026-04-18
-- Description: Adds inventory_bootstrap table to anchor opening-stock values
--              so the Inventory Report can compute rolling opening/closing
--              balances per range. Bootstrap date: 2026-01-01 (accountant-
--              replaceable). Seeds one row per (branch, product) and
--              (branch, fuel_type) with quantity=0 so every cycle has a
--              baseline even before the accountant enters real openings.

-- ============================================================
-- STEP 1: Create inventory_bootstrap table
-- ============================================================
CREATE TABLE "inventory_bootstrap" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "product_id" UUID NULL,
  "fuel_type_id" UUID NULL,
  "as_of_date" DATE NOT NULL,
  "quantity" DECIMAL(14, 3) NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_bootstrap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_bootstrap_branch_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_bootstrap_product_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_bootstrap_fuel_fkey"
    FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Exactly one of product_id / fuel_type_id must be set per row.
  CONSTRAINT "inventory_bootstrap_scope_check"
    CHECK ((product_id IS NOT NULL) <> (fuel_type_id IS NOT NULL))
);

-- ============================================================
-- STEP 2: Indexes for the report's running-balance lookups
-- ============================================================
CREATE UNIQUE INDEX "unique_bootstrap_product_scope"
  ON "inventory_bootstrap"("branch_id", "product_id", "as_of_date")
  WHERE "product_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_bootstrap_fuel_scope"
  ON "inventory_bootstrap"("branch_id", "fuel_type_id", "as_of_date")
  WHERE "fuel_type_id" IS NOT NULL;

CREATE INDEX "idx_inv_bootstrap_branch_date"
  ON "inventory_bootstrap"("branch_id", "as_of_date");
CREATE INDEX "idx_inv_bootstrap_product"
  ON "inventory_bootstrap"("product_id");
CREATE INDEX "idx_inv_bootstrap_fuel"
  ON "inventory_bootstrap"("fuel_type_id");

-- ============================================================
-- STEP 3: Seed bootstrap rows for 2026-01-01
-- ------------------------------------------------------------
-- Non-fuel products: one row per (active branch x product in same org).
-- Quantity=0 is an explicit placeholder - accountant updates via admin
-- path later. ON CONFLICT via the partial unique indexes keeps this
-- migration idempotent on reruns and safe against subsequent deploys.
-- ============================================================
INSERT INTO "inventory_bootstrap"
  ("branch_id", "product_id", "as_of_date", "quantity", "source", "notes")
SELECT b.id, p.id, DATE '2026-01-01', 0, 'bootstrap_2026-01-01',
       'Auto-seeded placeholder; replace with real opening quantity'
FROM branches b
JOIN products p ON p.organization_id = b.organization_id
WHERE b.is_active = TRUE
  AND p.is_active = TRUE
ON CONFLICT DO NOTHING;

-- Fuel: fuel_types is global (no organization_id column in this schema),
-- so seed one row per (active branch x fuel_type).
INSERT INTO "inventory_bootstrap"
  ("branch_id", "fuel_type_id", "as_of_date", "quantity", "source", "notes")
SELECT b.id, f.id, DATE '2026-01-01', 0, 'bootstrap_2026-01-01',
       'Auto-seeded placeholder; replace with real opening liters'
FROM branches b
CROSS JOIN fuel_types f
WHERE b.is_active = TRUE
ON CONFLICT DO NOTHING;
