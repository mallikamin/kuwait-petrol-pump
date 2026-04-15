# Credit Customer Receipts + Ledger - Technical Specification v2.1

**Version**: 2.1
**Status**: DRAFT — awaiting approval before implementation
**Last updated**: 2026-04-15

## 1. Overview

Add credit customer receipt posting, customer ledger with running balance, and credit limit soft warnings to the Kuwait POS accounting system.

**Currency**: PKR only
**Scale**: ~100 customers, design for ~100k ledger rows, fast report response

## 2. Business Rules

| # | Rule | Detail |
|---|------|--------|
| 1 | Balance sign | Positive = customer owes us. Negative = advance/overpayment |
| 2 | Receipt allocation | FIFO (auto, oldest first) **or** Manual (pick invoices) |
| 3 | Partial payment | Allowed. Unpaid residue remains open and visible |
| 4 | Overpayment | Kept as advance credit, carries forward |
| 5 | Backdated posting | Core requirement. Admin + Accountant roles |
| 6 | Edit/Delete | Admin + Accountant. Soft delete only. Audit trail via receipt revision |
| 7 | Receipt audit fields | user, timestamp, branch/pump, attachment, before/after snapshot |
| 8 | Credit limit | **Per customer per branch** (with org-wide fallback) |
| 9 | Credit check timing | **3 checkpoints**: (a) invoice creation, (b) invoice posting, (c) fuel sale completion |
| 10 | Customer hierarchy | Vehicle/slip-level activity rolls up to parent customer |
| 11 | Currency | PKR only |
| 12 | Reporting | Party-position summary + customer ledger detail + PDF/CSV/Excel export |

## 3. Roles & Permissions

**Allowed roles for credit operations**: `admin`, `accountant`

> **IMPORTANT**: "BPO" is an external stakeholder label only and does NOT map to any system role.
> Credit operations are restricted to `admin` and `accountant` roles.
> **Before implementation**, validate actual role IDs and permissions in the codebase (`User.role` enum values).
> `manager` is excluded from credit write operations for now.

| Operation | admin | accountant | manager | cashier | operator |
|-----------|-------|------------|---------|---------|----------|
| Create receipt | Yes | Yes | No | No | No |
| Edit receipt | Yes | Yes | No | No | No |
| Delete receipt (soft) | Yes | Yes | No | No | No |
| View ledger | Yes | Yes | Yes | Yes | No |
| View balance | Yes | Yes | Yes | Yes | No |
| View party position report | Yes | Yes | Yes | No | No |
| Export report | Yes | Yes | Yes | No | No |
| Set credit limit | Yes | Yes | No | No | No |
| View open invoices | Yes | Yes | No | No | No |

## 4. Data Model

### 4.1 New Tables

#### `customer_branch_limits`
Branch-scoped credit limits. Overrides `Customer.creditLimit` when present.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID PK | no | gen_random_uuid() |
| organization_id | UUID FK | no | → organizations.id (multi-tenant isolation) |
| customer_id | UUID FK | no | → customers.id |
| branch_id | UUID FK | no | → branches.id |
| credit_limit | DECIMAL(12,2) | no | Max outstanding balance for this customer at this branch |
| credit_days | INT | yes | Payment terms in days |
| is_active | BOOLEAN | no | Default true |
| created_at | TIMESTAMPTZ | no | Auto |
| updated_at | TIMESTAMPTZ | no | Auto |

**Constraints**:
- UNIQUE(organization_id, customer_id, branch_id)

**Credit limit resolution order**:
1. `customer_branch_limits` WHERE customer_id AND branch_id → branch-specific limit
2. `customers.credit_limit` → org-wide fallback
3. NULL → no limit enforced

#### `customer_receipts`
Records payments received from credit customers.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID PK | no | gen_random_uuid() |
| organization_id | UUID FK | no | → organizations.id |
| branch_id | UUID FK | no | → branches.id |
| customer_id | UUID FK | no | → customers.id |
| receipt_number | VARCHAR(50) | no | Auto: RCP-YYYYMMDD-NNN |
| receipt_datetime | TIMESTAMPTZ | no | Business datetime (supports backdating) |
| amount | DECIMAL(12,2) | no | Total receipt amount (PKR, must be > 0) |
| payment_method | VARCHAR(50) | no | cash, cheque, bank_transfer, online |
| bank_id | UUID FK | yes | → banks.id (if bank-routed) |
| reference_number | VARCHAR(100) | yes | Cheque#, UTR, etc. |
| notes | TEXT | yes | Free text |
| attachment_path | VARCHAR(500) | yes | File path for receipt scan |
| allocation_mode | VARCHAR(10) | no | 'FIFO' or 'MANUAL', default 'FIFO' |
| created_by | UUID FK | yes | → users.id |
| updated_by | UUID FK | yes | → users.id |
| deleted_by | UUID FK | yes | → users.id |
| created_at | TIMESTAMPTZ | no | Auto |
| updated_at | TIMESTAMPTZ | no | Auto |
| deleted_at | TIMESTAMPTZ | yes | Soft delete flag |

**Indexes**: `(organization_id, receipt_number)` UNIQUE, `customer_id`, `receipt_date`, `deleted_at`, `organization_id`

#### `customer_receipt_allocations`
Maps receipt payments to specific credit invoices. **Replace-on-edit**: on receipt edit, old allocations are deleted and new ones created within a single transaction. Audit trail is maintained via audit_log table capturing before/after snapshots.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID PK | no | gen_random_uuid() |
| receipt_id | UUID FK | no | → customer_receipts.id (CASCADE DELETE) |
| source_type | VARCHAR(30) | no | 'BACKDATED_TRANSACTION' or 'SALE' |
| source_id | UUID | no | ID of the invoice being paid |
| allocated_amount | DECIMAL(12,2) | no | Amount applied to this invoice (must be > 0) |
| created_at | TIMESTAMPTZ | no | Auto |

**Indexes**: `receipt_id`, `(source_type, source_id)`

### 4.2 Modified Tables

#### `customers` — Add `current_balance`
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| current_balance | DECIMAL(12,2) | 0 | Cached balance. Positive = owes us |

> The existing `credit_limit` and `credit_days` fields remain as **org-wide defaults**.
> Branch-scoped limits override via `customer_branch_limits` table.

### 4.3 NO Separate Ledger Table (Computed View)

The customer ledger is **computed at query time** from the union of all debit and credit sources. This avoids dual-write consistency issues and ensures the ledger is always fresh.

**Rationale**: BackdatedTransactions and Sales ARE the canonical credit events. CustomerReceipts ARE the canonical payment events. A separate ledger table would duplicate this data and require complex consistency maintenance, especially with backdated entries that insert events in the middle of the timeline.

## 5. Ledger Computation — All Sources

### 5.1 Debit Sources (Customer Owes More)

**Source A: BackdatedTransactions** (pre-finalization credit sales)
```sql
SELECT
  bt.id,
  bt.customer_id,
  bt.transaction_datetime AS entry_date,
  bt.created_at,
  'INVOICE' AS entry_type,
  'BACKDATED_TRANSACTION' AS source_type,
  bt.line_total AS debit_amount,
  0 AS credit_amount,
  bt.vehicle_number,
  bt.slip_number,
  bt.product_name || ' ' || bt.quantity || 'L @ ' || bt.unit_price || '/L' AS description,
  bt.backdated_entry_id,
  bt.created_by
FROM backdated_transactions bt
WHERE bt.customer_id = $1
  AND bt.payment_method = 'credit_customer'
  AND bt.deleted_at IS NULL
```

**Source B: Sales** (real-time POS credit sales, not from backdated finalization)
```sql
SELECT
  s.id,
  s.customer_id,
  s.sale_date AS entry_date,
  s.created_at,
  'INVOICE' AS entry_type,
  'SALE' AS source_type,
  s.total_amount AS debit_amount,
  0 AS credit_amount,
  s.vehicle_number,
  s.slip_number,
  COALESCE(
    (SELECT ft.code || ' ' || fs.quantity_liters || 'L'
     FROM fuel_sales fs JOIN fuel_types ft ON fs.fuel_type_id = ft.id
     WHERE fs.sale_id = s.id LIMIT 1),
    'Non-fuel sale'
  ) AS description,
  NULL AS backdated_entry_id,
  s.cashier_id AS created_by
FROM sales s
WHERE s.customer_id = $1
  AND s.payment_method IN ('credit', 'credit_customer')
  AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
```

> **Deduplication**: Sales created by backdated finalization have `offline_queue_id = 'backdated-{txn_id}'`.
> These are excluded from Source B since they're already in Source A.
> This prevents double-counting.

### 5.2 Credit Sources (Customer Pays)

**Source C: CustomerReceipts**
```sql
SELECT
  cr.id,
  cr.customer_id,
  cr.receipt_datetimetime AS entry_date,
  cr.created_at,
  'RECEIPT' AS entry_type,
  'CUSTOMER_RECEIPT' AS source_type,
  0 AS debit_amount,
  cr.amount AS credit_amount,
  NULL AS vehicle_number,
  cr.reference_number AS slip_number,
  cr.payment_method || ' receipt #' || cr.receipt_number AS description,
  NULL AS backdated_entry_id,
  cr.created_by
FROM customer_receipts cr
WHERE cr.customer_id = $1
  AND cr.deleted_at IS NULL
```

### 5.3 Combined Ledger Query with Running Balance

**Full query** (no date filter):
```sql
SELECT *,
  SUM(debit_amount - credit_amount) OVER (
    ORDER BY entry_date ASC, created_at ASC, source_type ASC, id ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM (
  -- Source A: BackdatedTransactions
  ... UNION ALL
  -- Source B: Sales (non-backdated credit)
  ... UNION ALL
  -- Source C: CustomerReceipts
  ...
) AS ledger
ORDER BY entry_date ASC, created_at ASC, source_type ASC, id ASC
LIMIT $limit OFFSET $offset
```

**Date-filtered query** (for reports with startDate/endDate):
```sql
-- Step 1: Calculate opening balance (all entries before startDate)
WITH opening_balance AS (
  SELECT COALESCE(SUM(debit_amount - credit_amount), 0) AS balance
  FROM (
    -- Source A: BackdatedTransactions before startDate
    SELECT bt.transaction_datetime AS entry_date, bt.line_total AS debit_amount, 0 AS credit_amount
    FROM backdated_transactions bt
    WHERE bt.customer_id = $1 AND bt.payment_method = 'credit_customer' AND bt.deleted_at IS NULL
      AND bt.transaction_datetime < $startDate
    UNION ALL
    -- Source B: Sales before startDate
    SELECT s.sale_date AS entry_date, s.total_amount AS debit_amount, 0 AS credit_amount
    FROM sales s
    WHERE s.customer_id = $1 AND s.payment_method IN ('credit', 'credit_customer')
      AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
      AND s.sale_date < $startDate
    UNION ALL
    -- Source C: CustomerReceipts before startDate
    SELECT cr.receipt_datetimetime AS entry_date, 0 AS debit_amount, cr.amount AS credit_amount
    FROM customer_receipts cr
    WHERE cr.customer_id = $1 AND cr.deleted_at IS NULL
      AND cr.receipt_datetime < $startDate
  ) AS prior_entries
),

-- Step 2: Period entries with running balance starting from opening
period_entries AS (
  SELECT *,
    (SELECT balance FROM opening_balance) +
    SUM(debit_amount - credit_amount) OVER (
      ORDER BY entry_date ASC, created_at ASC, source_type ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_balance
  FROM (
    -- Source A: BackdatedTransactions in period
    SELECT bt.id, bt.customer_id, bt.transaction_datetime AS entry_date, bt.created_at,
      'INVOICE' AS entry_type, 'BACKDATED_TRANSACTION' AS source_type,
      bt.line_total AS debit_amount, 0 AS credit_amount,
      bt.vehicle_number, bt.slip_number,
      bt.product_name || ' ' || bt.quantity || 'L @ ' || bt.unit_price || '/L' AS description,
      bt.backdated_entry_id, bt.created_by
    FROM backdated_transactions bt
    WHERE bt.customer_id = $1 AND bt.payment_method = 'credit_customer' AND bt.deleted_at IS NULL
      AND bt.transaction_datetime BETWEEN $startDate AND $endDate

    UNION ALL

    -- Source B: Sales in period
    SELECT s.id, s.customer_id, s.sale_date AS entry_date, s.created_at,
      'INVOICE' AS entry_type, 'SALE' AS source_type,
      s.total_amount AS debit_amount, 0 AS credit_amount,
      s.vehicle_number, s.slip_number,
      COALESCE((SELECT ft.code || ' ' || fs.quantity_liters || 'L'
                FROM fuel_sales fs JOIN fuel_types ft ON fs.fuel_type_id = ft.id
                WHERE fs.sale_id = s.id LIMIT 1), 'Non-fuel sale') AS description,
      NULL AS backdated_entry_id, s.cashier_id AS created_by
    FROM sales s
    WHERE s.customer_id = $1 AND s.payment_method IN ('credit', 'credit_customer')
      AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
      AND s.sale_date BETWEEN $startDate AND $endDate

    UNION ALL

    -- Source C: CustomerReceipts in period
    SELECT cr.id, cr.customer_id, cr.receipt_datetimetime AS entry_date, cr.created_at,
      'RECEIPT' AS entry_type, 'CUSTOMER_RECEIPT' AS source_type,
      0 AS debit_amount, cr.amount AS credit_amount,
      NULL AS vehicle_number, cr.reference_number AS slip_number,
      cr.payment_method || ' receipt #' || cr.receipt_number AS description,
      NULL AS backdated_entry_id, cr.created_by
    FROM customer_receipts cr
    WHERE cr.customer_id = $1 AND cr.deleted_at IS NULL
      AND cr.receipt_datetime BETWEEN $startDate AND $endDate
  ) AS period_ledger
)

SELECT * FROM period_entries
ORDER BY entry_date ASC, created_at ASC, source_type ASC, id ASC
LIMIT $limit OFFSET $offset;
```

> **Running balance correctness**: All source queries select `id`, `created_at`, `source_type` for deterministic ordering. Stable tie-break chain: `entry_date ASC, created_at ASC, source_type ASC, id ASC`. Date-filtered reports compute opening balance from all prior entries, then apply running sum to period entries starting from that opening.

## 6. Balance Maintenance Strategy

### 6.1 Cached Balance on Customer

`Customer.currentBalance` is a **cached aggregate** for O(1) credit limit checks.

**Formula**:
```
currentBalance = SUM(all_credit_debits) - SUM(all_receipt_credits)
```

### 6.2 Events That Modify Balance

| Event | Balance Change | Source |
|-------|---------------|--------|
| Credit sale created (BackdatedTxn) | + lineTotal | Existing code (no change) |
| Credit sale edited (BackdatedTxn) | + (new - old) delta | Existing code (no change) |
| Credit sale soft-deleted (BackdatedTxn) | - lineTotal | Existing code (no change) |
| Real-time POS credit sale | + totalAmount | Existing code (no change) |
| Receipt created | - amount | New credit service |
| Receipt edited | adjust delta | New credit service |
| Receipt soft-deleted | + amount (restore) | New credit service |

### 6.3 Concurrency Strategy: Full Recalculation with Row Lock

**Why not delta-based updates?** Deltas accumulate rounding errors and can drift under concurrent writes or crash recovery. Full recalculation is O(1) for ~100 customers and always correct.

**Transaction pattern for EVERY balance-modifying operation:**
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Lock the customer row to prevent concurrent balance updates
  await tx.$queryRaw`
    SELECT id FROM customers
    WHERE id = ${customerId}
    FOR UPDATE
  `;

  // 2. Perform the business operation (create/update/delete receipt)
  const receipt = await tx.customerReceipt.create({ ... });

  // 3. Full recalculation of balance from ALL sources
  const [debitResult] = await tx.$queryRaw`
    SELECT COALESCE(SUM(line_total), 0) as total
    FROM backdated_transactions
    WHERE customer_id = ${customerId}
    AND payment_method = 'credit_customer'
    AND deleted_at IS NULL
  `;
  const [posDebitResult] = await tx.$queryRaw`
    SELECT COALESCE(SUM(total_amount), 0) as total
    FROM sales
    WHERE customer_id = ${customerId}
    AND payment_method IN ('credit', 'credit_customer')
    AND (offline_queue_id IS NULL OR offline_queue_id NOT LIKE 'backdated-%')
  `;
  const [creditResult] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM customer_receipts
    WHERE customer_id = ${customerId}
    AND deleted_at IS NULL
  `;

  const newBalance = debitResult.total + posDebitResult.total - creditResult.total;

  // 4. Update cached balance
  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance: newBalance },
  });

  return receipt;
});
```

> **`FOR UPDATE`** prevents two concurrent receipt postings from reading stale balance.
> **Full recalculation** guarantees correctness regardless of crash recovery state.
> Under ~100 customers, performance impact is negligible.

### 6.4 Balance Sync for Existing Debit Events

**CONSISTENCY MODEL: Explicit Auto-Reconciliation on Read**

Since we do NOT modify the existing BackdatedEntries or Sales services, the cached balance may drift when credit sales are posted without calling the credit service.

**Chosen Strategy: Auto-reconcile on every balance query with explicit reporting**

On **every** balance-accessing operation (`getCustomerLedger()`, `getCustomerBalance()`, `checkCreditLimit()`):
1. Compute live balance from ALL sources (BackdatedTransactions + Sales + CustomerReceipts)
2. Compare with cached `currentBalance`
3. If drift detected (abs diff > 0.01 PKR):
   - Update cached balance to match live calculation
   - **Log drift event** (timestamp, customer, cached value, live value, source of read)
   - **Return drift metadata** in API response for transparency
4. Return live balance (always authoritative)

```typescript
async function getCustomerBalance(customerId: string): Promise<CustomerBalanceDto> {
  // Always compute live balance from sources
  const liveBalance = await recalculateBalance(customerId);

  // Get cached balance
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  const cachedBalance = customer?.currentBalance?.toNumber() ?? 0;

  let driftCorrected = false;
  let driftAmount = 0;

  // Auto-correct if drift detected
  if (Math.abs(liveBalance - cachedBalance) > 0.01) {
    driftAmount = liveBalance - cachedBalance;
    await prisma.customer.update({
      where: { id: customerId },
      data: { currentBalance: liveBalance },
    });
    // Log drift event for monitoring
    await prisma.auditLog.create({
      data: {
        action: 'BALANCE_DRIFT_CORRECTED',
        entityType: 'CUSTOMER',
        entityId: customerId,
        changes: { cached: cachedBalance, live: liveBalance, drift: driftAmount },
      },
    });
    driftCorrected = true;
  }

  return {
    customerId,
    currentBalance: liveBalance, // Always return live balance
    driftCorrected,               // Explicit flag
    driftAmount,                  // Magnitude of correction
    ...
  };
}
```

**Why this model:**
- **No changes to existing modules** (BackdatedEntries, Sales, reconciliation)
- **Always correct** (live calculation is source of truth)
- **Transparent** (drift events logged and reported in API)
- **Self-healing** (cached balance auto-corrects on next read)
- **Monitorable** (drift log enables alerting if issue persists)

**Performance**: O(1) queries per customer (~100 customers), negligible overhead. If performance becomes an issue, consider periodic batch reconciliation job.

## 7. Credit Limit Checks — 3 Checkpoints

### 7.1 Resolution Logic
```typescript
async function getCreditLimit(customerId: string, branchId: string): Promise<number | null> {
  // 1. Branch-specific limit
  const branchLimit = await prisma.customerBranchLimit.findUnique({
    where: {
      organizationId_customerId_branchId: {
        organizationId,
        customerId,
        branchId
      }
    },
  });
  if (branchLimit?.isActive) return branchLimit.creditLimit.toNumber();

  // 2. Org-wide fallback
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  return customer?.creditLimit?.toNumber() ?? null; // null = no limit
}
```

### 7.2 Check Function
```typescript
interface CreditCheckResult {
  allowed: boolean;       // always true (soft warning only)
  warning: boolean;       // true if over limit
  currentBalance: number;
  creditLimit: number | null;
  proposedAmount: number;
  newBalance: number;     // currentBalance + proposedAmount
  utilizationPct: number; // (newBalance / creditLimit) * 100
  message: string;
}

async function checkCreditLimit(
  customerId: string,
  branchId: string,
  proposedAmount: number
): Promise<CreditCheckResult> {
  // Recalculate live balance (auto-reconcile on read)
  const liveBalance = await getCustomerBalance(customerId).then(r => r.currentBalance);
  const limit = await getCreditLimit(customerId, branchId);
  const newBalance = liveBalance + proposedAmount;

  return {
    allowed: true, // SOFT WARNING ONLY — never block
    warning: limit !== null && newBalance > limit,
    currentBalance: liveBalance,
    creditLimit: limit,
    proposedAmount,
    newBalance,
    utilizationPct: limit ? (newBalance / limit) * 100 : 0,
    message: limit !== null && newBalance > limit
      ? `Warning: Balance ${newBalance.toFixed(2)} PKR exceeds limit ${limit.toFixed(2)} PKR`
      : 'Within credit limit',
  };
}
```

### 7.3 Checkpoint Integration (Additive — No existing code changes)

| Checkpoint | Where | How |
|-----------|-------|-----|
| **(a) Invoice creation** | `GET /api/credit/check-limit?customerId=X&branchId=Y&amount=Z` | Frontend calls before saving credit_customer transaction |
| **(b) Invoice posting** | `GET /api/credit/check-limit?customerId=X&branchId=Y&amount=Z` | Frontend calls on backdated entry save |
| **(c) Fuel sale completion** | `GET /api/credit/check-limit?customerId=X&branchId=Y&amount=Z` | POS frontend calls at sale completion |

> All three checkpoints call the SAME endpoint (GET). The frontend is responsible for calling it at the right moment.
> The backend returns a warning; the frontend shows it. **No blocking.**

## 8. Allocation Integrity

### 8.1 Validation Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | `SUM(allocations.amount) <= receipt.amount` | Service-layer check before write |
| 2 | Each `allocation.amount > 0` | Zod schema: `z.number().positive()` |
| 3 | Allocation target must belong to same customer | Query validation: `WHERE customer_id = receipt.customer_id` |
| 4 | Allocation target must be an open invoice | Check: `invoice.lineTotal > SUM(existing_allocations)` |
| 5 | No over-allocation on same invoice under concurrency | `SELECT ... FOR UPDATE` on allocation targets |

### 8.2 Over-Allocation Prevention (Concurrency-Safe)

```typescript
async function validateAllocations(
  tx: PrismaTransaction,
  customerId: string,
  allocations: Array<{ sourceType: string; sourceId: string; amount: number }>,
  receiptAmount: number,
  excludeReceiptId?: string // for edit: exclude current receipt's existing allocations
): Promise<void> {
  // Rule 1: sum <= receipt amount
  const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocTotal > receiptAmount) {
    throw new AppError(400, `Allocation total ${allocTotal} exceeds receipt amount ${receiptAmount}`);
  }

  // Rule 2: each > 0 (enforced by Zod, but double-check)
  if (allocations.some(a => a.amount <= 0)) {
    throw new AppError(400, 'All allocation amounts must be positive');
  }

  for (const alloc of allocations) {
    // Rule 3: target belongs to same customer
    let invoiceAmount: number;
    if (alloc.sourceType === 'BACKDATED_TRANSACTION') {
      const [row] = await tx.$queryRaw`
        SELECT line_total, customer_id FROM backdated_transactions
        WHERE id = ${alloc.sourceId} AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!row || row.customer_id !== customerId) {
        throw new AppError(400, `Invoice ${alloc.sourceId} not found or wrong customer`);
      }
      invoiceAmount = parseFloat(row.line_total);
    } else {
      const [row] = await tx.$queryRaw`
        SELECT total_amount, customer_id FROM sales
        WHERE id = ${alloc.sourceId}
        FOR UPDATE
      `;
      if (!row || row.customer_id !== customerId) {
        throw new AppError(400, `Sale ${alloc.sourceId} not found or wrong customer`);
      }
      invoiceAmount = parseFloat(row.total_amount);
    }

    // Rule 4+5: no over-allocation (with row lock from FOR UPDATE above)
    const [existing] = await tx.$queryRaw`
      SELECT COALESCE(SUM(allocated_amount), 0) as total
      FROM customer_receipt_allocations cra
      JOIN customer_receipts cr ON cra.receipt_id = cr.id
      WHERE cra.source_type = ${alloc.sourceType}
        AND cra.source_id = ${alloc.sourceId}
        AND cr.deleted_at IS NULL
        ${excludeReceiptId ? Prisma.sql`AND cr.id != ${excludeReceiptId}` : Prisma.empty}
    `;

    const alreadyAllocated = parseFloat(existing.total);
    const remainingOpen = invoiceAmount - alreadyAllocated;

    if (alloc.amount > remainingOpen + 0.01) { // 0.01 tolerance for rounding
      throw new AppError(400,
        `Cannot allocate ${alloc.amount} to invoice ${alloc.sourceId}: ` +
        `only ${remainingOpen.toFixed(2)} remaining (${invoiceAmount} total, ${alreadyAllocated} already allocated)`
      );
    }
  }
}
```

### 8.3 FIFO Auto-Allocation Logic

```typescript
async function autoAllocateFIFO(
  tx: PrismaTransaction,
  customerId: string,
  receiptAmount: number,
  receiptId: string
): Promise<void> {
  let remaining = receiptAmount;

  // Get all open invoices ordered by date (oldest first)
  const openInvoices = await tx.$queryRaw`
    SELECT
      id, 'BACKDATED_TRANSACTION' as source_type, line_total as amount,
      transaction_datetime as entry_date
    FROM backdated_transactions
    WHERE customer_id = ${customerId}
      AND payment_method = 'credit_customer'
      AND deleted_at IS NULL

    UNION ALL

    SELECT
      id, 'SALE' as source_type, total_amount as amount,
      sale_date as entry_date
    FROM sales
    WHERE customer_id = ${customerId}
      AND payment_method IN ('credit', 'credit_customer')
      AND (offline_queue_id IS NULL OR offline_queue_id NOT LIKE 'backdated-%')

    ORDER BY entry_date ASC
  `;

  for (const invoice of openInvoices) {
    if (remaining <= 0) break;

    // How much is already allocated to this invoice?
    const [existing] = await tx.$queryRaw`
      SELECT COALESCE(SUM(allocated_amount), 0) as total
      FROM customer_receipt_allocations cra
      JOIN customer_receipts cr ON cra.receipt_id = cr.id
      WHERE cra.source_type = ${invoice.source_type}
        AND cra.source_id = ${invoice.id}
        AND cr.deleted_at IS NULL
    `;

    const alreadyAllocated = parseFloat(existing.total);
    const invoiceAmount = parseFloat(invoice.amount);
    const openAmount = invoiceAmount - alreadyAllocated;

    if (openAmount <= 0) continue; // Fully paid

    const allocateNow = Math.min(remaining, openAmount);

    await tx.customerReceiptAllocation.create({
      data: {
        receiptId,
        sourceType: invoice.source_type,
        sourceId: invoice.id,
        allocatedAmount: allocateNow,
      },
    });

    remaining -= allocateNow;
  }

  // Any remaining amount = overpayment/advance — no allocation needed, balance goes negative
}
```

## 9. Edit/Delete Audit Safety

### 9.1 Soft Delete Only

Receipts are **never hard-deleted**. On delete:
- Set `deleted_at = NOW()`, `deleted_by = userId`
- Cascade: allocations stay (referenced via receipt, but effectively void since receipt is soft-deleted)
- Recalculate customer balance

### 9.2 Immutable Audit History

All receipt mutations write to the existing `audit_log` table:

```typescript
await tx.auditLog.create({
  data: {
    userId,
    action: 'RECEIPT_CREATED' | 'RECEIPT_UPDATED' | 'RECEIPT_DELETED',
    entityType: 'CUSTOMER_RECEIPT',
    entityId: receiptId,
    changes: {
      before: beforeSnapshot,  // null for create
      after: afterSnapshot,    // null for delete
      allocations_before: [...],
      allocations_after: [...],
    },
    ipAddress: req.ip,
  },
});
```

**Audit fields captured**: receipt amount, payment method, bank, reference number, receipt datetime, allocation details (which invoice, how much), who changed, when, before/after values.

### 9.3 Edit Behavior

On receipt edit:
1. Snapshot current state (before)
2. Delete existing allocations
3. Apply new values
4. Re-allocate (FIFO or manual)
5. Snapshot new state (after)
6. Write audit log
7. Recalculate balance
8. All within a single `$transaction`

## 10. Customer Hierarchy — Vehicle Rollup

### 10.1 Current Mapping

Vehicle → Customer mapping exists via two mechanisms:
- **`Customer.vehicleNumbers`** (String[]): registered vehicles for this customer
- **`BackdatedTransaction.vehicleNumber`** (per-transaction): actual vehicle on the slip

### 10.2 Rollup Query

All credit activity for a customer includes ALL transactions posted against their `customerId`, regardless of which specific vehicle was used.

```sql
-- Vehicle-level breakdown within a customer's ledger
SELECT
  vehicle_number,
  COUNT(*) as transaction_count,
  SUM(line_total) as total_amount
FROM backdated_transactions
WHERE customer_id = $1
  AND payment_method = 'credit_customer'
  AND deleted_at IS NULL
GROUP BY vehicle_number
ORDER BY total_amount DESC
```

### 10.3 Ledger Detail

The ledger response includes `vehicleNumber` on each entry, allowing the UI to:
- Show per-vehicle subtotals within a customer's ledger
- Filter by vehicle
- Group by vehicle in reports

> **No new schema needed.** The existing `Customer.vehicleNumbers` + transaction-level `vehicleNumber` provides the mapping. All rollup is via `customerId` FK.

## 11. API Endpoints

All under `/api/credit/` prefix, require authentication.

### 11.1 Receipt Operations

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | /receipts | admin, accountant | Create receipt with allocation |
| PUT | /receipts/:id | admin, accountant | Edit receipt (re-allocate) |
| DELETE | /receipts/:id | admin, accountant | Soft delete receipt |
| GET | /receipts | admin, accountant | List receipts (filtered) |
| GET | /receipts/:id | admin, accountant | Receipt detail + allocations |

### 11.2 Ledger & Balance

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /customers/:id/ledger | admin, accountant, manager, cashier | Customer ledger with running balance |
| GET | /customers/:id/balance | admin, accountant, manager, cashier | Quick balance + credit limit info |
| GET | /customers/:id/open-invoices | admin, accountant | Open invoices for allocation |
| GET | /check-limit | all authenticated | Credit limit soft warning check |

### 11.3 Reporting

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | /report/party-position | admin, accountant, manager | All customers with balances, limits, utilization |
| GET | /report/export | admin, accountant, manager | Export PDF/CSV/Excel |

### 11.4 Credit Limits

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| PUT | /customers/:id/branch-limit | admin, accountant | Set/update branch-specific credit limit |
| GET | /customers/:id/branch-limits | admin, accountant | Get all branch limits for a customer |

### 11.5 Endpoint Details

#### POST /receipts
```json
{
  "customerId": "uuid",
  "branchId": "uuid",
  "receiptDatetime": "2026-04-15T10:30:00Z",
  "amount": 50000.00,
  "paymentMethod": "cash",
  "bankId": null,
  "referenceNumber": "CHQ-12345",
  "notes": "Partial payment for April",
  "attachmentPath": null,
  "allocationMode": "FIFO",
  "allocations": []
}
```

For manual mode:
```json
{
  "allocationMode": "MANUAL",
  "allocations": [
    { "sourceType": "BACKDATED_TRANSACTION", "sourceId": "uuid", "amount": 30000 },
    { "sourceType": "BACKDATED_TRANSACTION", "sourceId": "uuid", "amount": 20000 }
  ]
}
```

#### GET /report/party-position
**Query params**: `hideZeroBalance` (boolean), `customerId` (optional single-customer filter)

**Scope**: Organization-wide only. No branch filtering in v1.

**Response**:
```json
{
  "header": {
    "title": "Sundar Estate PSO Pump",
    "subtitle": "Party Position Report",
    "date": "2026-04-15",
    "branch": "Main Branch"
  },
  "customers": [
    {
      "id": "uuid",
      "name": "Customer A",
      "phone": "0300-1234567",
      "creditLimit": 500000,
      "currentBalance": 140000,
      "utilizationPct": 28.0,
      "lastTransactionDate": "2026-04-12",
      "lastReceiptDate": "2026-04-05",
      "totalDebit": 840000,
      "totalCredit": 700000,
      "vehicleCount": 3,
      "overLimit": false
    }
  ],
  "totals": {
    "totalOutstanding": 2500000,
    "totalCreditLimit": 10000000,
    "overLimitCount": 2,
    "customerCount": 45
  }
}
```

#### GET /report/export
**Query params**: `format` (pdf|csv|excel), `customerId` (optional), `startDate`, `endDate`, `hideZeroBalance`

**PDF header**: "Sundar Estate PSO Pump" with branch name, date range, generation timestamp.

#### GET /customers/:id/ledger
**Query params**: `startDate`, `endDate`, `limit` (default 100), `offset`, `vehicleNumber` (optional filter), `entryType` (optional: INVOICE|RECEIPT)

**Response**:
```json
{
  "customer": {
    "id": "uuid",
    "name": "Customer A",
    "phone": "0300-1234567",
    "creditLimit": 500000,
    "currentBalance": 40000,
    "branchLimit": 300000
  },
  "entries": [
    {
      "id": "uuid",
      "date": "2026-04-01",
      "type": "INVOICE",
      "sourceType": "BACKDATED_TRANSACTION",
      "description": "HSD 500L @ 280/L",
      "vehicleNumber": "ABC-123",
      "slipNumber": "SL-001",
      "debit": 140000,
      "credit": 0,
      "balance": 140000
    },
    {
      "id": "uuid",
      "date": "2026-04-05",
      "type": "RECEIPT",
      "sourceType": "CUSTOMER_RECEIPT",
      "description": "Cash receipt #RCP-20260405-001",
      "referenceNumber": null,
      "debit": 0,
      "credit": 100000,
      "balance": 40000
    }
  ],
  "summary": {
    "openingBalance": 0,
    "totalDebit": 140000,
    "totalCredit": 100000,
    "closingBalance": 40000
  },
  "vehicleBreakdown": [
    { "vehicleNumber": "ABC-123", "totalAmount": 80000, "transactionCount": 5 },
    { "vehicleNumber": "XYZ-789", "totalAmount": 60000, "transactionCount": 3 }
  ],
  "pagination": { "total": 2, "limit": 100, "offset": 0 }
}
```

#### GET /check-limit
**Query params**: `customerId` (uuid), `branchId` (uuid), `amount` (number)

**Response**:
```json
{
  "allowed": true,
  "warning": false,
  "currentBalance": 40000,
  "creditLimit": 500000,
  "proposedAmount": 50000,
  "newBalance": 90000,
  "utilizationPct": 18.0,
  "message": "Within credit limit"
}
```

## 12. Migration Plan

### 12.1 Forward Migration SQL

```sql
-- 1. Add current_balance to customers (safe: defaults to 0, no constraint on existing rows)
ALTER TABLE "customers" ADD COLUMN "current_balance" DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- 2. Create customer_branch_limits table
CREATE TABLE "customer_branch_limits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "credit_limit" DECIMAL(12, 2) NOT NULL,
  "credit_days" INT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "customer_branch_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_branch_limits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_branch_limits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_branch_limits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "unique_customer_branch_limit" ON "customer_branch_limits"("organization_id", "customer_id", "branch_id");

-- 3. Create customer_receipts table
CREATE TABLE "customer_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "receipt_number" VARCHAR(50) NOT NULL,
  "receipt_datetime" TIMESTAMPTZ NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "payment_method" VARCHAR(50) NOT NULL,
  "bank_id" UUID,
  "reference_number" VARCHAR(100),
  "notes" TEXT,
  "attachment_path" VARCHAR(500),
  "allocation_mode" VARCHAR(10) NOT NULL DEFAULT 'FIFO',
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "unique_receipt_number" ON "customer_receipts"("organization_id", "receipt_number");
CREATE INDEX "idx_receipts_customer" ON "customer_receipts"("customer_id");
CREATE INDEX "idx_receipts_datetime" ON "customer_receipts"("receipt_datetime");
CREATE INDEX "idx_receipts_org" ON "customer_receipts"("organization_id");
CREATE INDEX "idx_receipts_deleted" ON "customer_receipts"("deleted_at");

-- 4. Create customer_receipt_allocations table
CREATE TABLE "customer_receipt_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receipt_id" UUID NOT NULL,
  "source_type" VARCHAR(30) NOT NULL,
  "source_id" UUID NOT NULL,
  "allocated_amount" DECIMAL(12, 2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "customer_receipt_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_allocations_receipt" ON "customer_receipt_allocations"("receipt_id");
CREATE INDEX "idx_allocations_source" ON "customer_receipt_allocations"("source_type", "source_id");
```

### 12.2 Rollback SQL
```sql
DROP TABLE IF EXISTS "customer_receipt_allocations";
DROP TABLE IF EXISTS "customer_receipts";
DROP TABLE IF EXISTS "customer_branch_limits";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "current_balance";
```

### 12.3 Data Backfill — ALL Receivable Sources

Run after migration to set initial `current_balance` from ALL existing credit sources:

```sql
-- Backfill current_balance from ALL receivable sources
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
```

### 12.4 Backfill Verification
```sql
-- Verify: show customers with non-zero balance after backfill
SELECT c.id, c.name, c.current_balance, c.credit_limit
FROM customers c
WHERE c.current_balance != 0
ORDER BY c.current_balance DESC;
```

## 13. Impacted Files

### New Files (additive only)
| File | Purpose |
|------|---------|
| `packages/database/prisma/migrations/20260415_credit_receipts/migration.sql` | Migration |
| `apps/backend/src/modules/credit/credit.service.ts` | Core business logic |
| `apps/backend/src/modules/credit/credit.controller.ts` | HTTP handlers |
| `apps/backend/src/modules/credit/credit.routes.ts` | Route definitions |
| `apps/backend/src/modules/credit/credit.schema.ts` | Zod validation |
| `apps/web/src/pages/CreditReceipts.tsx` | Receipt posting UI |
| `apps/web/src/pages/CustomerLedger.tsx` | Ledger view + report UI |
| `apps/web/src/api/credit.ts` | Frontend API client |

### Modified Files (minimal wiring only)
| File | Change | Risk |
|------|--------|------|
| `packages/database/prisma/schema.prisma` | Add 3 models + 1 field on Customer | Schema only |
| `apps/backend/src/app.ts` | Add 1 import + 1 app.use() line | None |
| `apps/web/src/App.tsx` | Add 2 route entries | None |
| `apps/web/src/components/layout/Sidebar.tsx` | Add 2 menu items | None |

### Zero-Change Files (explicitly NOT modified)
- `BackdatedEntries.tsx` / `BackdatedEntries2.tsx`
- `backdated-entries.service.ts` / `daily.service.ts`
- All reconciliation code
- All existing reports
- `sales.service.ts`
- `customers.service.ts` (existing methods unchanged)

## 14. Deferred Items

| Item | Status | Design Hook |
|------|--------|-------------|
| QuickBooks sync for receipts | Deferred | Add qbSyncStatus to CustomerReceipt in Phase 2 |
| Hard credit blocking | Deferred | checkCreditLimit returns `allowed: true` always |
| Advanced approval workflows | Deferred | None needed yet |
| Role granularity refinement | Deferred | Uses admin + accountant for now |
| Aging report | Phase 1.5 | Ledger data + entry_date supports computation |
| Opening balance import | Phase 1.5 | Set via currentBalance field or manual receipt |
| PDF receipt printing | Phase 1.5 | Data available via /receipts/:id API |
| Customer group labels | Phase 2 | No schema change needed |
| Event-driven balance sync | Phase 2 | Hook into BackdatedEntries service |
| Salesman/branch filter on reports | Deferred | Not requested yet |

## 15. Testing Strategy

### Unit Tests
- Receipt creation (FIFO + manual)
- Allocation validation (all 5 rules)
- Partial payment with residue tracking
- Overpayment → advance credit
- Backdated receipt
- Edit receipt → balance recalculation + audit log
- Delete receipt → balance restoration + audit log
- Credit limit warning (branch-scoped + org fallback)
- Concurrent receipt posting (lock contention)
- FIFO allocation ordering correctness
- Balance recalculation from all sources
- Auto-reconciliation on read (drift correction)

### Integration Tests
- Full workflow: credit sale → receipt → ledger balance → party position
- Concurrent receipts to same customer
- Receipt with bank routing
- Ledger pagination + date filtering
- Ledger vehicle filter
- Party position report accuracy
- Export endpoint (PDF/CSV/Excel headers)
- Date-filtered ledger with correct opening balance

### Regression Tests (ZERO existing feature impact)
- BackdatedEntries2 workflow: create, edit, delete, finalize → unchanged
- Reconciliation logic → unchanged
- Sales reporting → unchanged
- Customer CRUD → unchanged (new field has DEFAULT 0)
- Dashboard → unchanged

---

## Changelog: v2.0 → v2.1

**10 issues fixed (8 from review + 2 from user clarifications):**

1. **[CRITICAL]** Running balance query consistency & determinism (Section 5)
   - Added `created_at`, `source_type`, `id` to ALL source queries (A, B, C)
   - Stable ordering chain: `entry_date ASC, created_at ASC, source_type ASC, id ASC`
   - Added explicit date-filtered ledger query with correct opening balance calculation
   - Opening balance now computed from ALL prior entries before applying running sum to period

2. **[CRITICAL]** API method conflict resolved (Section 7.3, 11.2, 11.5)
   - Changed `/check-limit` from POST to GET (read-only operation)
   - Final contract: `GET /api/credit/check-limit?customerId=X&branchId=Y&amount=Z`
   - Added full endpoint spec in 11.5 with query params and response schema

3. **[HIGH]** Balance consistency model (Section 6.4) — MAJOR REVISION
   - Removed vague "silent auto-correct" wording
   - **Explicit consistency model**: Auto-reconcile on read with drift reporting
   - API responses now include `driftCorrected` flag and `driftAmount` field
   - All drift events logged to audit_log for monitoring
   - Code example shows transparent drift correction
   - Clarifies: no changes to existing modules, self-healing on read

4. **[HIGH]** Tenant isolation gap fixed (Section 4.1, 7.1, 12.1)
   - Added `organization_id` to `customer_branch_limits` table
   - Updated UNIQUE constraint to `(organization_id, customer_id, branch_id)`
   - Updated credit limit resolution logic in Section 7.1
   - Migration SQL updated with org FK and index

5. **[HIGH]** Allocation immutability wording (Section 4.1, Business Rules)
   - Changed "Immutable" to "Replace-on-edit with audit log"
   - Clarified: allocations are deleted/recreated on edit, but audit trail preserved via audit_log
   - Removed contradictory language

6. **[MEDIUM]** BPO role mapping removed (Section 3)
   - **BPO is now external stakeholder label only** (not mapped to any system role)
   - Credit operations restricted to `admin` and `accountant` roles explicitly
   - Added warning to validate role IDs in codebase before implementation

7. **[MEDIUM]** Report filter scope (Section 11.5)
   - **Party position report is organization-wide only in v1** (no branch filter)
   - Removed `branchId` query param from `/report/party-position` and `/report/export`
   - Query params now: `hideZeroBalance`, `customerId` (optional single-customer filter)
   - Added explicit scope note: "Organization-wide only. No branch filtering in v1."

8. **[MEDIUM]** Encoding corruption
   - Fixed all em-dashes and arrows
   - Cleaned throughout document

9. **[CLARIFICATION]** Opening balance explicit contract (Section 5.3)
   - Opening balance = cumulative (debits - credits) **before** startDate
   - Running balance inside range starts from openingBalance
   - Period query shows: openingBalance → period movements → closingBalance

10. **[CLARIFICATION]** Ledger response schema (Section 11.5)
    - Added `openingBalance` field to ledger summary
    - Summary now: `{ openingBalance, totalDebit, totalCredit, closingBalance }`
    - Closing balance = opening + total debits - total credits in period

11. **[CHANGE REQUEST]** Receipt datetime precision (Section 4.1, 5.2, 12.1)
    - Changed `receipt_date` (DATE) → `receipt_datetime` (TIMESTAMPTZ)
    - Enables deterministic same-day multi-receipt ordering
    - Ledger ordering: `entry_date/entry_datetime, created_at, source_type, id`
    - Updated migration SQL, API examples, and opening-balance query filters
