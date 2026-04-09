# CRITICAL BUG: Meter Totals Using Derived Readings from Adjacent Days

## Problem
The `getDailySummary` API endpoint returns incorrect meter totals because it uses **derived** readings from adjacent days instead of only actual **entered** readings for the target date.

## Root Cause
**File**: `apps/backend/src/modules/backdated-entries/daily.service.ts`
**Lines**: 176-205

The code calculates meter totals using `nozzle.opening?.value` and `nozzle.closing?.value` WITHOUT checking the reading status. These values can be:
- `status: 'entered'` - Actual readings for the target date ✅
- `status: 'derived_from_prev_shift'` - Derived from previous day ❌
- `status: 'derived_from_next_shift'` - Derived from next day ❌

## Evidence (April 2, 2026 Test)
**Database Reality**:
```sql
-- Meter readings FOR April 2 (actual)
HSD: 1100L (from meter_readings table WHERE date='2026-04-02')
PMG: 1250L

-- Meter readings FOR April 3 (adjacent day with negative adjustment)
HSD: -602200L
PMG: -1503150L
```

**API Returns** (WRONG):
```json
{
  "meterTotals": {
    "hsdLiters": 602200,    // ❌ Should be 1100
    "pmgLiters": 1503150    // ❌ Should be 1250
  }
}
```

**Nozzle-level data shows derivation**:
```json
{
  "nozzleId": "D1N1-HSD",
  "openingReading": 0,      // Actual reading for April 2
  "closingReading": 0,      // ❌ DERIVED from April 3's opening (should be 400)
  "meterLiters": 100600     // ❌ WRONG (0 - (-100600) from April 3)
}
```

## Impact
- **Reconciliation fails**: Users cannot finalize days because meter totals don't match actual sales
- **Data corruption**: Negative adjustments on adjacent days pollute current day's totals
- **False blocking**: Days with correct data show as unreconciled

## Fix
### Option 1: Filter by Status (RECOMMENDED)
Only use readings with `status === 'entered'` for meter total calculations:

```typescript
// In daily.service.ts, lines 175-206
selectedShifts.forEach((shiftData) => {
  shiftData.nozzles.forEach((nozzle) => {
    // ✅ FIX: Only use ENTERED readings, skip derived
    const opening = nozzle.opening?.status === 'entered' ? nozzle.opening.value : null;
    const closing = nozzle.closing?.status === 'entered' ? nozzle.closing.value : null;

    if (opening === null || opening === undefined || closing === null || closing === undefined) {
      return; // Skip if either actual reading is missing
    }

    const liters = closing - opening;
    // ... rest of logic
  });
});
```

### Option 2: Query Meter Readings Directly
Bypass the meter-readings service and query `meter_readings` table directly for the target date only:

```typescript
const meterReadingsForDate = await prisma.meterReading.findMany({
  where: {
    shiftInstance: {
      branchId,
      date: businessDateObj,
    },
  },
  include: {
    nozzle: { include: { fuelType: true } },
  },
});

// Calculate totals from actual readings only
```

## Verification Test
After fix, re-run April 2 API call:
```bash
curl -H "Authorization: Bearer TOKEN" \
"https://kuwaitpos.duckdns.org/api/backdated-entries/daily?branchId=...&businessDate=2026-04-02"
```

**Expected**:
```json
{
  "meterTotals": {
    "hsdLiters": 1100,
    "pmgLiters": 1250
  },
  "postedTotals": {
    "hsdLiters": 1100,
    "pmgLiters": 1250
  },
  "remainingLiters": {
    "hsd": 0,
    "pmg": 0,
    "total": 0
  }
}
```

## Files to Fix
1. `apps/backend/src/modules/backdated-entries/daily.service.ts` (lines 175-206)
2. Add test case in `daily.service.test.ts` to verify derived readings are ignored for totals

## Related Context
- Meter readings service (`meter-readings-daily.service.ts`) intentionally fetches adjacent days for UX auto-derivation
- Derivation logic is CORRECT for UI (helps users avoid re-entering data)
- The BUG is in how `daily.service.ts` USES this data for accounting calculations
- Derived values should ONLY be shown in UI for convenience, NOT used for reconciliation math

## Priority
**P0 - CRITICAL**: Blocks workflow validation and prevents users from finalizing days with correct data.
