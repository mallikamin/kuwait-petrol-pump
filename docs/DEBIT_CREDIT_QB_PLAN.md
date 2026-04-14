# Debit/Credit + Credit Limit + QB Sync Plan

Date: 2026-04-14
Owner: Kuwait POS engineering
Status: Drafted for execution

## Objectives
- Keep live production POS running and collecting correct data immediately.
- Add proper customer receivable lifecycle (debit sales + credit receipts/adjustments).
- Enforce customer credit limits in backend (authoritative), not UI-only.
- Sync to QuickBooks in a controlled cutover with idempotency and no duplicates.

## Phase 0 - Immediate Stabilization (Now)
- Customer-wise sales report includes walk-in and slip number.
- Keep existing POS posting behavior stable while we prepare AR primitives.
- Freeze accounting semantics: define canonical payment method mapping.

## Phase 1 - Data Model for AR
- Add `customer_ledger_entries` table:
  - debit (sale on credit customer)
  - credit (receipt/payment received)
  - adjustment_debit / adjustment_credit
  - references: customer_id, sale_id (optional), receipt_id (optional), created_by, notes
  - immutable amounts and running-balance friendly ordering (posted_at + id)
- Add `customer_receipts` table:
  - receipt_no, customer_id, amount, payment_method, bank_id (optional), reference, receipt_date
- Add indexes for customer/date/range reporting.

## Phase 2 - Backend Enforcement + Posting
- On sale creation:
  - if payment method is customer credit, create ledger debit entry.
  - enforce credit limit in backend transaction before commit.
- Add receipt APIs:
  - create receipt -> ledger credit entry
  - list receipts / customer statement
- Add adjustment APIs with role guard (manager/accountant only).
- Add idempotency keys for offline-safe replay.

## Phase 3 - UI Integration
- POS/Collections screen for customer receipt entry.
- Customer statement page with running balance, debit/credit columns.
- Real-time credit usage indicator from backend statement/balance endpoint.
- Block/override flow when limit exceeded (with manager approval path optional).

## Phase 4 - Reporting + Reconciliation
- Customer-wise report enhancements:
  - optional filters for walk-in only / credit-customer only
  - slip + vehicle + payment + debit/credit markers
- Add AR aging report (0-30, 31-60, 61-90, 90+ days).
- Add reconciliation report between sales, receipts, and outstanding balances.

## Phase 5 - QuickBooks Cutover (No Duplicate Strategy)
- Pre-cutover mapping:
  - customer, item, payment method, bank, AR accounts mapping complete
- Cutover window:
  - choose cutover timestamp T
  - sync historical POS data <= T once with idempotency keys
  - verify totals against reconciliation report
- Post-cutover:
  - enable ongoing queue sync > T only
  - hard duplicate guard via deterministic idempotency keys per document
- Rollback strategy:
  - replay-safe by source doc IDs and sync logs

## Validation Gates
- Unit tests: posting and credit limit edge cases.
- Integration tests: offline replay + duplicate prevention.
- Staging dry run: historical import + reconciliation.
- Production guard checks before enabling continuous QB sync.

## Open Questions (Need Business Confirmation)
1. Should walk-in sales ever create AR entries? (default: no)
2. Do we allow partial receipt against multiple invoices, or FIFO auto-allocation?
3. Credit limit policy on breach:
   - hard block
   - manager override
   - allow and flag
4. Backdated entries with `credit_customer`: should they post AR by transaction date or posting date?
5. QB posting style for credit customer sales:
   - Invoice + ReceivePayment
   - SalesReceipt to AR-like clearing account (not recommended)
6. During historical import, exact date range and source of truth files?

## Recommended Execution Order
1. Phase 1 + Phase 2 backend first (authoritative correctness)
2. Phase 3 UI
3. Phase 4 reports
4. Phase 5 QB cutover
