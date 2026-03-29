-- AlterTable: Update QB Connection sync_mode to support DRY_RUN and FULL_SYNC modes
-- Migration: Add DRY_RUN and FULL_SYNC sync modes (Task 5 - Production Hardening)
--
-- This migration updates the syncMode field to support:
-- - READ_ONLY: No writes to QuickBooks (default)
-- - DRY_RUN: Validate and simulate writes without QB API calls
-- - FULL_SYNC: Full production sync with actual QB API calls
--
-- Note: Existing WRITE_ENABLED mode is renamed to FULL_SYNC for clarity

-- Update existing WRITE_ENABLED values to FULL_SYNC
UPDATE "qb_connections"
SET "sync_mode" = 'FULL_SYNC'
WHERE "sync_mode" = 'WRITE_ENABLED';

-- Update schema comment (informational only - no actual schema change needed)
COMMENT ON COLUMN "qb_connections"."sync_mode" IS 'Sync mode: READ_ONLY | DRY_RUN | FULL_SYNC';
