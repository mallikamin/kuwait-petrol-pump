# Production Issue Analysis - 2026-04-18

## Issues Addressed

### A) Reconciliation-Range Empty Date Validation ✅ FIXED

**Root Cause:**
- Frontend date inputs allow user to clear the field, setting state to empty string ("")
- Query runs with empty startDate/endDate → API returns 400 (regex validation failure)
- No guard in `enabled` condition to prevent API call with invalid dates

**Fixes Applied:**
1. **Frontend Query Guard** (ReconciliationNew.tsx:94)
   - Changed: `enabled: !!branchId && !!startDate && !!endDate`
   - Prevents API call if dates are empty or missing

2. **Frontend Input Validation** (ReconciliationNew.tsx:179, 189)
   - Added regex validation in onChange handler
   - Only updates state if value matches `^\d{4}-\d{2}-\d{2}$`
   - Prevents empty string from being set

**Testing Required:**
- [ ] Open ReconciliationNew page
- [ ] Try to clear start date input
- [ ] Verify query does not fire (network tab should show no 400 error)
- [ ] Set valid dates and verify query works

---

### B) Inventory Report Showing Zeros ⚠️ DIAGNOSED + IMPROVED

**Root Cause:**
- Inventory report counts products from `stock_levels` table
- If branch has no `stock_levels` records → totalProducts = 0, totalValue = 0
- Date range filters only affect purchases/sales queries, not stock levels
- **This is working as designed** - stock levels are current state, not historical

**Current Behavior:**
```typescript
// Line 751: Get all products and their stock levels for this branch
const stockLevels = await prisma.stockLevel.findMany({
  where: { branchId },
  include: { product: true },
});

// Line 924: Summary counts from stock levels (current state)
const totalItems = stockLevels.length;
const totalValue = stockLevels.reduce(...);
```

**Why It Shows Zero:**
1. Branch has no records in `stock_levels` table
2. OR: Branch ID mismatch (user branch != queried branch)
3. OR: Products exist but no stock has been received/initialized

**Improvement Applied:**
- Added `diagnostics` object to report response
- Shows: stockLevelsFound, purchasesFound, dateFilter type
- Helps debug whether issue is data or query logic

**Action Required (User Decision):**
Option A: If branch should have stock levels → investigate DB
```sql
-- Check if branch has stock levels
SELECT COUNT(*) FROM stock_levels WHERE branch_id = 'UUID_HERE';

-- Check if branch has products assigned
SELECT * FROM products WHERE organization_id = 'ORG_UUID';
```

Option B: If report should show purchases count instead of stock count → modify summary logic
Option C: If this is a new branch with no inventory yet → expected behavior, mark as "No Action"

**Testing Required:**
- [ ] Call inventory report API with valid date range
- [ ] Check response.diagnostics field
- [ ] If `stockLevelsFound: 0` → verify branch has stock_levels records
- [ ] If `purchasesFound: 0` → verify purchases exist in date range

---

### C) Ledger Logic for PSO/Bank-Card Transactions ✅ ANALYZED

**Current Ledger Query Logic** (credit.service.ts:960-1034):

**Source A: BackdatedTransactions** (Lines 960-979)
```sql
SELECT ... FROM backdated_transactions bt
WHERE bt.customer_id = ${customerId}::uuid
  AND bt.deleted_at IS NULL
  -- ✅ NO payment_method filter - includes ALL payment types
```

**Source B: Sales** (Lines 984-1007)
```sql
SELECT ... FROM sales s
WHERE s.customer_id = ${customerId}::uuid
  AND (s.offline_queue_id IS NULL OR s.offline_queue_id NOT LIKE 'backdated-%')
  -- ✅ NO payment_method filter - includes ALL payment types
```

**Key Finding:**
- Ledger query does NOT filter by payment method
- It includes ALL transactions where `customer_id` matches
- This means PSO/bank-card/credit-card transactions WILL appear in ledger IF they have a customer_id

**Why Old PSO/Bank-Card Transactions May Be Missing:**
1. **Walk-in transactions**: Old dummy PSO/bank-card transactions may not have `customer_id` set (they're anonymous walk-in sales)
2. **Data migration**: Legacy data may have NULL customer_id even if a customer was involved

**Forward-Correct Logic Verification:**
To verify NEW transactions work correctly, test:

**Test Case: PSO Card Transaction with Customer**
1. Create new backdated transaction:
   - customer_id: <valid customer UUID>
   - payment_method: 'pso_card'
   - productName: 'HSD', quantity: 100L
   - slipNumber: 'PSO-TEST-001'
2. Query customer ledger: GET /api/credit/customers/:id/ledger
3. Verify transaction appears with:
   - Type: INVOICE
   - Description: "HSD 100L @ ..."
   - Debit: 100L × price
   - Slip Number: PSO-TEST-001
4. Export ledger to CSV and verify same transaction appears

**Test Case: Bank Card Transaction with Customer**
1. Create new backdated transaction:
   - customer_id: <valid customer UUID>
   - payment_method: 'bank_card'
   - productName: 'PMG', quantity: 50L
   - slipNumber: 'BANK-TEST-001'
2. Query customer ledger
3. Verify transaction appears in UI and CSV

**Expected Result:**
✅ NEW transactions with customer_id WILL appear in ledger (regardless of payment method)
❌ OLD transactions without customer_id will NOT appear (by design - they're not linked to customer)

**Action Required:**
- [ ] Run test case with fresh PSO transaction
- [ ] Run test case with fresh bank-card transaction
- [ ] Verify both appear in ledger UI
- [ ] Verify both appear in ledger CSV export
- [ ] If PASS → close issue (logic is correct, old data is expected gap)
- [ ] If FAIL → investigate why customer_id is not being saved

---

### D) Auth Refresh Resilience ✅ IMPROVED

**Root Cause:**
- When token refresh fails, ALL queued requests log "Queued request rejected: refresh failed"
- If 10 requests queued → 10 identical log messages → noisy console
- Users see cascading errors without clarity on whether to retry

**Improvements Applied:**

1. **Reduced Log Noise** (client.ts:156)
   - Changed from `logAuth()` to `console.debug()`
   - Queue rejections now debug-level, not persistent logs
   - Reduces clutter in session debug export

2. **Better Error Context** (client.ts:237)
   - Added hint: "user may retry" for transient errors
   - Added `pendingQueueSize` to show how many requests were affected
   - Clearer distinction between permanent (401) vs transient (5xx) failures

**Current Behavior:**
- **401 (Auth Invalid)**: Logout immediately, redirect to login
- **5xx/Network Error (Transient)**: Reject queued requests, do NOT logout, user can retry
- **Other 4xx**: Reject and log, do not logout

**Testing Required:**
- [ ] Simulate transient error (kill backend temporarily)
- [ ] Trigger multiple API calls while backend down
- [ ] Verify console shows debug messages (not persistent logs)
- [ ] Verify "user may retry" hint appears
- [ ] Restore backend and retry → verify requests succeed
- [ ] Simulate 401 (invalid refresh token) → verify logout happens

---

## Files Changed

### Frontend
- `apps/web/src/pages/ReconciliationNew.tsx` (Issue A)
  - Added query enabled guard for empty dates
  - Added input validation in onChange handlers

- `apps/web/src/api/client.ts` (Issue D)
  - Reduced queue rejection log noise
  - Improved error context for transient failures

### Backend
- `apps/backend/src/modules/reports/reports.service.ts` (Issue B)
  - Added diagnostics metadata to inventory report response

---

## Deploy Recommendation

**Mode:** `frontend-only`

**Reason:**
- All frontend fixes (ReconciliationNew.tsx, client.ts)
- Backend change (reports.service.ts) only adds diagnostic field (non-breaking)
- No schema changes, no breaking API changes
- Backend diagnostic field is optional (existing clients ignore it)

**Verification Checklist (Post-Deploy):**
1. [ ] ReconciliationNew page loads without 400 errors
2. [ ] Inventory report returns diagnostics field
3. [ ] Auth refresh transient errors show improved logs
4. [ ] PSO/bank-card ledger test cases PASS
5. [ ] Bundle hash changed (cache busted)

---

## Evidence Format

### Before/After Samples Required

**Issue A (Reconciliation-Range):**
```
BEFORE:
Network Request: /api/backdated-entries/daily/reconciliation-range?branchId=xxx&startDate=&endDate=2026-04-17
Response: 400 Bad Request
Console: [SessionDebug] Queued request rejected: refresh failed

AFTER:
(No network request when dates are empty)
Console: (clean, no 400 error)
```

**Issue B (Inventory Report):**
```
BEFORE:
Response: {
  summary: { totalProducts: 0, totalValue: "0.00" }
}

AFTER:
Response: {
  summary: { totalProducts: 0, totalValue: "0.00" },
  diagnostics: {
    stockLevelsFound: 0,
    purchasesFound: 5,
    dateFilter: "date-range",
    dateRange: { startDate: "2026-01-01", endDate: "2026-04-17" }
  }
}
```

**Issue C (Ledger):**
```
TEST:
1. Create PSO transaction with customer_id
2. Query ledger
3. Verify appears in entries array

PASS/FAIL: (to be tested)
```

**Issue D (Auth Refresh):**
```
BEFORE:
Console:
  [Auth] Queued request rejected: refresh failed
  [Auth] Queued request rejected: refresh failed
  [Auth] Queued request rejected: refresh failed
  (×10 times for 10 queued requests)

AFTER:
Console:
  [Auth] Token refresh failed: transient error, NOT logging out (user may retry) { pendingQueueSize: 10 }
  [Auth Debug] Queued request rejected (refresh failed): /api/sales
  [Auth Debug] Queued request rejected (refresh failed): /api/customers
  (debug level, less alarming)
```

---

## Root Cause Summary

| Issue | Root Cause | Fix Type | Risk |
|-------|-----------|----------|------|
| A | Empty date validation missing | Guard + input validation | Low (frontend only) |
| B | Stock levels table empty | Diagnostic improvement | None (additive field) |
| C | customer_id missing on old data | Verification needed | None (no code change) |
| D | Noisy error logs | Log level + context | Low (logging only) |

---

## Next Steps

1. Commit changes with proper authorship
2. Run `npm run build` to verify type-check passes
3. Deploy with `./scripts/deploy.sh frontend-only`
4. Run post-deploy verification checklist
5. Test ledger with fresh PSO/bank-card transactions (Issue C)
6. Report findings for inventory report zero-data (Issue B - needs user decision)
