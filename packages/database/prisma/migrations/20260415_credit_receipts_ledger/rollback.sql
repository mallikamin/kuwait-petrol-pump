-- Rollback Migration: Credit Customer Receipts + Ledger
-- Version: 2.1
-- Date: 2026-04-15
-- WARNING: This will DELETE all credit receipt data. Run only if migration must be reverted.

-- ============================================================
-- ROLLBACK PROCEDURE
-- ============================================================

-- STEP 1: Drop dependent tables first (foreign key constraints)
DROP TABLE IF EXISTS "customer_receipt_allocations";
DROP TABLE IF EXISTS "customer_receipts";
DROP TABLE IF EXISTS "customer_branch_limits";

-- STEP 2: Remove current_balance column from customers
ALTER TABLE "customers" DROP COLUMN IF EXISTS "current_balance";

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Verify tables no longer exist
SELECT
  'customer_branch_limits' AS table_name,
  NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_branch_limits' AND table_schema = 'public'
  ) AS dropped
UNION ALL
SELECT
  'customer_receipts' AS table_name,
  NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_receipts' AND table_schema = 'public'
  ) AS dropped
UNION ALL
SELECT
  'customer_receipt_allocations' AS table_name,
  NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_receipt_allocations' AND table_schema = 'public'
  ) AS dropped
UNION ALL
SELECT
  'customers.current_balance' AS table_name,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'current_balance' AND table_schema = 'public'
  ) AS dropped;
