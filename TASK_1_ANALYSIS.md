# Task #1: Backdated Meter V2 Finalize Flow + UI Cleanup

## Root Cause Analysis

### Issue 1: Save Button Not Working
**Location**: `apps/web/src/pages/BackdatedEntries2.tsx:672-674`

**Root Cause**:
```typescript
<Button ... onClick={() => saveDraftMut.mutateAsync(undefined)} ...>
```

The Save button calls `saveDraftMut.mutateAsync(undefined)` without error handling. If the mutation throws an error (e.g., validation error, network error), it results in an unhandled promise rejection. The user sees no feedback and `isDirty` remains true, preventing finalize.

**Validation errors that could occur**:
- Line 369: "Please select a branch"
- Line 370: "No transactions to save"
- Line 371: Credit validation errors (missing customer, vehicle#, slip#)

**Fix**: Wrap the mutation call in try-catch or use the mutation's error handling properly.

---

### Issue 2: Cash Variance Notification After Finalize
**Location**: `apps/backend/src/modules/backdated-entries/daily.service.ts:1640-1646`

**Root Cause**:
```typescript
// Add cash gap warning if it exists (for audit visibility)
if (Math.abs(cashGap) > cashTolerancePkr) {
  responsePayload.cashGapWarning = {
    amount: parseFloat(cashGap.toFixed(2)),
    message: `Cash variance: PKR ${Math.abs(cashGap).toFixed(2)} ${cashGap > 0 ? 'short' : 'excess'}`
  };
}
```

The backend always returns `cashGapWarning` if there's a cash gap, **even when the day is already finalized** (lines 1313-1332). Since cash gap is now "warning only, not a blocker" (line 1356-1357), showing it for already-finalized days is confusing because it's not actionable.

**Current behavior**:
- Cash gap appears in success dialog even if day was already finalized days ago
- User might think they need to take action when none is needed

**Fix**: Only include `cashGapWarning` if this is a fresh finalization (not already finalized).

---

### Issue 3: Extra Details in Left Customer Group Column
**Location**: `apps/web/src/pages/BackdatedEntries2.tsx:860-882`

**Current state**: V2 left panel only shows `customerName` (line 880). No extra details.

**V1 comparison** (`BackdatedEntries.tsx:2393-2404`):
- Shows customer name + transaction count badge + total liters + total amount

**Conclusion**: V2 is already minimal. No changes needed unless referring to a different location.

---

## Files to Modify

1. **Frontend V2**: `apps/web/src/pages/BackdatedEntries2.tsx`
   - Fix Save button error handling
   - Add test for save validation errors

2. **Backend Service**: `apps/backend/src/modules/backdated-entries/daily.service.ts`
   - Suppress cash gap warning for already-finalized days
   - Add test for this behavior

3. **Frontend V1** (if needed): `apps/web/src/pages/BackdatedEntries.tsx`
   - Check if Save button has same issue

---

## Test Plan

### Test 1: Save Button Error Handling
1. Open V2 with no branch selected
2. Add transaction
3. Click Save → should show "Please select a branch"
4. Select branch, add transaction with credit_customer but no vehicle#
5. Click Save → should show validation error
6. Network test: Mock API error, click Save → should show error message

### Test 2: Cash Variance After Finalize
1. Create day with cash variance (e.g., 100 PKR short)
2. Finalize day → should show cash warning
3. Reload page, finalize again → should NOT show cash warning (already finalized)
4. Check that message says "already finalized" not "successfully finalized"

### Test 3: isDirty Flag
1. Add transaction → isDirty = true, Save button enabled, Finalize disabled
2. Click Save → isDirty = false, Finalize enabled
3. Modify transaction → isDirty = true again

---

## Implementation Steps

1. Fix Save button: Add try-catch or proper error callback
2. Fix backend: Add `alreadyFinalized` check before adding cash warning
3. Add frontend tests for save error scenarios
4. Add backend test for finalize idempotency + warning suppression
5. Manual test both V1 and V2 save flows
6. Document any remaining edge cases
