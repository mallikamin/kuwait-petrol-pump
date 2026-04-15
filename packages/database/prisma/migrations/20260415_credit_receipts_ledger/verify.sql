-- Verification Queries: Validate migration and backfill
-- Run AFTER backfill.sql to verify data integrity
-- Version: 2.1
-- Date: 2026-04-15

-- ============================================================
-- Verification 1: Schema objects exist
-- ============================================================

SELECT
  'customer_branch_limits' AS table_name,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_branch_limits' AND table_schema = 'public'
  ) AS exists
UNION ALL
SELECT
  'customer_receipts' AS table_name,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_receipts' AND table_schema = 'public'
  ) AS exists
UNION ALL
SELECT
  'customer_receipt_allocations' AS table_name,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'customer_receipt_allocations' AND table_schema = 'public'
  ) AS exists
UNION ALL
SELECT
  'customers.current_balance' AS table_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'current_balance' AND table_schema = 'public'
  ) AS exists;

-- ============================================================
-- Verification 2: Constraints and indexes
-- ============================================================

-- CHECK constraints
SELECT conname AS constraint_name, conrelid::regclass AS table_name
FROM pg_constraint
WHERE conname IN (
  'customer_receipts_amount_positive',
  'customer_receipts_allocation_mode_check',
  'customer_receipt_allocations_amount_positive',
  'customer_receipt_allocations_source_type_check'
)
ORDER BY conname;

-- Unique indexes (created via CREATE UNIQUE INDEX, not constraint)
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN (
  'unique_customer_branch_limit',
  'unique_receipt_number'
)
ORDER BY tablename, indexname;

-- Regular indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN (
  'idx_customer_branch_limits_org',
  'idx_customer_branch_limits_customer',
  'idx_receipts_customer',
  'idx_receipts_datetime',
  'idx_receipts_org',
  'idx_receipts_deleted',
  'idx_allocations_receipt',
  'idx_allocations_source'
)
ORDER BY tablename, indexname;

-- ============================================================
-- Verification 3: Sample customers with balance
-- ============================================================

SELECT
  c.id,
  c.name,
  c.current_balance,
  c.credit_limit,
  ROUND((c.current_balance / NULLIF(c.credit_limit, 0)) * 100, 2) AS utilization_pct
FROM customers c
WHERE c.current_balance != 0
ORDER BY c.current_balance DESC
LIMIT 10;

-- ============================================================
-- Verification 4: Balance recalculation spot check
-- ============================================================

-- Compare cached balance vs live calculation for first 5 customers with non-zero balance
WITH customer_sample AS (
  SELECT id FROM customers WHERE current_balance != 0 LIMIT 5
),
live_balance AS (
  SELECT
    cs.id AS customer_id,
    COALESCE(SUM(bt.line_total), 0) AS backdated_debit,
    COALESCE((
      SELECT SUM(s.total_amount)
      FROM sales s
      WHERE s.customer_id = cs.id
        AND s.payment_method IN ('credit', 'credit_customer')
        AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
    ), 0) AS pos_debit,
    COALESCE((
      SELECT SUM(cr.amount)
      FROM customer_receipts cr
      WHERE cr.customer_id = cs.id AND cr.deleted_at IS NULL
    ), 0) AS receipts_credit
  FROM customer_sample cs
  LEFT JOIN backdated_transactions bt ON bt.customer_id = cs.id
    AND bt.payment_method = 'credit_customer'
    AND bt.deleted_at IS NULL
  GROUP BY cs.id
)
SELECT
  c.id,
  c.name,
  c.current_balance AS cached_balance,
  (lb.backdated_debit + lb.pos_debit - lb.receipts_credit) AS live_balance,
  ABS(c.current_balance - (lb.backdated_debit + lb.pos_debit - lb.receipts_credit)) AS drift,
  CASE
    WHEN ABS(c.current_balance - (lb.backdated_debit + lb.pos_debit - lb.receipts_credit)) < 0.01
    THEN 'OK'
    ELSE 'DRIFT DETECTED'
  END AS status
FROM customers c
JOIN live_balance lb ON c.id = lb.customer_id
ORDER BY drift DESC;

-- ============================================================
-- Verification 5: Summary stats
-- ============================================================

SELECT
  (SELECT COUNT(*) FROM customers WHERE current_balance > 0) AS customers_with_receivable,
  (SELECT COUNT(*) FROM customers WHERE current_balance < 0) AS customers_with_advance,
  (SELECT COUNT(*) FROM customers WHERE current_balance = 0) AS customers_zero_balance,
  (SELECT COALESCE(SUM(current_balance), 0) FROM customers WHERE current_balance > 0) AS total_receivables_pkr,
  (SELECT COALESCE(SUM(ABS(current_balance)), 0) FROM customers WHERE current_balance < 0) AS total_advances_pkr;
