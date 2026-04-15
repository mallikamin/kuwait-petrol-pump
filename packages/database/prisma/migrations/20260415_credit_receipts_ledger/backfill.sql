-- Data Backfill: Populate current_balance from existing credit sources
-- Run AFTER migration.sql is applied
-- Version: 2.1
-- Date: 2026-04-15

-- ============================================================
-- Backfill current_balance for all customers
-- ============================================================

-- Formula: current_balance = SUM(credit_debits) - SUM(receipt_credits)
-- Sources:
--   - BackdatedTransactions (payment_method = 'credit_customer')
--   - Sales (payment_method IN ('credit', 'credit_customer'), excluding backdated-originated)
--   - CustomerReceipts (will be 0 at migration time)

UPDATE customers c SET current_balance = (
  -- Source A: BackdatedTransactions (credit_customer)
  COALESCE((
    SELECT SUM(bt.line_total)
    FROM backdated_transactions bt
    WHERE bt.customer_id = c.id
      AND bt.payment_method = 'credit_customer'
      AND bt.deleted_at IS NULL
  ), 0)
  +
  -- Source B: Sales (real-time POS credit, excluding backdated-originated)
  COALESCE((
    SELECT SUM(s.total_amount)
    FROM sales s
    WHERE s.customer_id = c.id
      AND s.payment_method IN ('credit', 'credit_customer')
      AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
  ), 0)
  -
  -- Source C: CustomerReceipts (will be 0 at migration time)
  COALESCE((
    SELECT SUM(cr.amount)
    FROM customer_receipts cr
    WHERE cr.customer_id = c.id
      AND cr.deleted_at IS NULL
  ), 0)
);

-- Report number of customers with non-zero balance after backfill
SELECT COUNT(*) AS customers_with_balance
FROM customers
WHERE current_balance != 0;
