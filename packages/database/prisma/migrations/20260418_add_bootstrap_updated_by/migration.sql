-- Inventory Bootstrap Audit Column Migration
-- Version: 1.0
-- Date: 2026-04-18
-- Description: Adds updated_by to inventory_bootstrap so edits through the
--              admin API carry a user reference for audit / dashboards.
--              Nullable + ON DELETE SET NULL so we never block user deletes.

ALTER TABLE "inventory_bootstrap"
  ADD COLUMN IF NOT EXISTS "updated_by" UUID;

ALTER TABLE "inventory_bootstrap"
  ADD CONSTRAINT "inventory_bootstrap_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_inv_bootstrap_updated_by"
  ON "inventory_bootstrap"("updated_by");
