# Kuwait Petrol Pump - Error Log

## CRITICAL BUG: Data Loss from Partial Saves (2026-04-09)

### Issue Summary
User saved 12 backdated transactions (1100L HSD + 1900L PMG) but only 4 were persisted in the database (799L HSD + 1470L PMG).

### Root Cause
**Delete-on-omission logic was executing on every partial save**, deleting existing transactions that weren't in the current payload.

**Flow:**
1. User saves batch 1 of transactions (e.g., 1 txn) → walk-in entry created, 1 transaction inserted
2. User saves batch 2 (e.g., 2 txns) → walk-in entry exists, `canDeleteMissing = true` (both new txns have IDs)
3. Backend deletes all transactions from batch 1 that aren't in batch 2 payload
4. Repeat for batches 3, 4, 5... Each time deleting 2 transactions from previous saves
5. Final result: Only 4 transactions remain (last 2 batches × 2 txns each)

### Evidence
Database query at 2026-04-09 11:00 UTC:
```sql
SELECT COUNT(*), SUM(CAST(quantity AS NUMERIC)) as total_liters
FROM backdated_transactions
WHERE transaction_datetime >= '2026-04-01' AND transaction_datetime < '2026-04-02'
```
Result: count=4, total_liters=2269.000 (should be 12, 3000.000)

Backend logs showed:
```
[BackdatedEntries] Upserted walk-in transactions: { total: 1, created: 1, updated: 0, deleted: 2 }
[BackdatedEntries] Upserted walk-in transactions: { total: 2, created: 2, updated: 0, deleted: 2 }
[BackdatedEntries] Upserted walk-in transactions: { total: 3, created: 3, updated: 0, deleted: 2 }
[BackdatedEntries] Upserted walk-in transactions: { total: 4, created: 4, updated: 0, deleted: 2 }
```

Each save was deleting 2 transactions from the walk-in entry.

### Fix Applied

**Commit:** 6e940d3 (2026-04-09 11:09 UTC)

**Changes:**

1. **Backend** (`daily.service.ts`):
   - Enhanced `canDeleteMissing` logic to only delete when BOTH conditions are true:
     - All incoming rows have stable IDs (no new rows without IDs)
     - **NEW:** Incoming transaction count >= existing count (prevents partial-save loss)
   - Added detailed logging for deletion safety checks

2. **Frontend** (`BackdatedEntries.tsx`):
   - Added detailed logging for outbound payload (nozzleId distribution, total liters)
   - Tracks `withNozzleIds` vs `withoutNozzleIds` count
   - Logs total liters being sent to API

### Testing Plan

**Before User Tests:**
1. SSH to server and clear old test data for 2026-04-01:
   ```bash
   docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production \
     -c "DELETE FROM backdated_transactions WHERE transaction_datetime >= '2026-04-01' AND transaction_datetime < '2026-04-02';"
   ```

2. Verify deletion:
   ```bash
   docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production \
     -c "SELECT COUNT(*) FROM backdated_transactions WHERE transaction_datetime >= '2026-04-01' AND transaction_datetime < '2026-04-02';"
   ```

**User Test Script:**
1. Load BackdatedEntries for 2026-04-01
2. Add transactions in batches (don't add all at once):
   - Batch 1: 3 HSD transactions → Save
   - Batch 2: 4 PMG transactions → Save
   - Batch 3: 2 HSD transactions → Save
   - Batch 4: 3 PMG transactions → Save
3. Verify total shows 12 transactions (1100L HSD + 1900L PMG)
4. Check browser console logs for outbound payload counts
5. Finalize day if meter readings reconcile

**Backend Validation:**
```bash
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production \
  -c "SELECT COUNT(*), SUM(CAST(quantity AS NUMERIC)) as total_liters, COUNT(DISTINCT fuel_type_id) as fuel_types FROM backdated_transactions WHERE transaction_datetime >= '2026-04-01' AND transaction_datetime < '2026-04-02';"
```

Expected: count=12, total_liters≈3000, fuel_types=2

### Deployment Status
- ✅ Commit 6e940d3 pushed to GitHub
- ✅ Server checked out 6e940d3
- ✅ Frontend deployed (bundle: index-BwQ3qA0v.js)
- ✅ Backend rebuilt and running
- ✅ API health check passing

### Related Files Modified
- `apps/backend/src/modules/backdated-entries/daily.service.ts` (lines 590-630, 830-870)
- `apps/web/src/pages/BackdatedEntries.tsx` (lines 968-1005)

### Incident Timeline
- **2026-04-08**: User reports 12 transactions showing as 4 after save
- **2026-04-09 11:00 UTC**: Database verified - only 4 transactions persisted
- **2026-04-09 11:09 UTC**: Root cause identified and fix committed
- **2026-04-09 11:23 UTC**: Fix deployed to production
