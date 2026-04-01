# TASK 1: Shifts API Fix - Replace Hardcoded Data
**Date**: 2026-04-02
**Status**: ✅ COMPLETED (Build verified, awaiting deployment evidence)

---

## Problem
`apps/web/src/pages/Shifts.tsx` had hardcoded `SEEDED_SHIFTS` constant (lines 24-41) with specific UUIDs from database seed. This was a TEMP UAT hack that prevented the shifts page from dynamically loading shift templates from the backend API.

```typescript
// OLD: Hardcoded shifts
const SEEDED_SHIFTS = [
  {
    id: '2cf99710-4971-4357-9673-d5f1ebf4d256',
    shift_number: 1,
    name: 'Day Shift',
    start_time: '06:00',
    end_time: '18:00',
    is_active: true,
  },
  // ...
];
```

## Solution Implemented

### 1. Added ShiftTemplate Type ✅
**File**: `apps/web/src/types/index.ts`

Added proper type definition for shift templates (distinct from shift instances):

```typescript
// Shift Template (from shifts table - defines shift schedules)
export interface ShiftTemplate {
  id: string;
  branchId: string;
  shiftNumber: number;
  name: string;
  startTime: string; // ISO datetime string
  endTime: string; // ISO datetime string
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}
```

### 2. Updated API Type Signature ✅
**File**: `apps/web/src/api/shifts.ts`

Fixed `getAll()` method to return `ShiftTemplate` instead of `Shift`:

```typescript
// BEFORE
getAll: async (): Promise<PaginatedResponse<Shift>> => { ... }

// AFTER
getAll: async (): Promise<PaginatedResponse<ShiftTemplate>> => { ... }
```

### 3. Replaced Hardcoded Data with API Call ✅
**File**: `apps/web/src/pages/Shifts.tsx`

**Changes**:
- Removed `SEEDED_SHIFTS` constant completely
- Added `useQuery` hook to fetch shift templates from `GET /api/shifts`
- Added loading state with spinner
- Added error state with user-friendly message
- Added empty state (no shift templates configured)
- Added `formatTime()` helper to format ISO datetime strings
- Updated all references from `SEEDED_SHIFTS` to `shiftTemplates`

```typescript
// NEW: API-driven shifts
const { data: shiftsResponse, isLoading: shiftsLoading, error: shiftsError } = useQuery({
  queryKey: ['shifts', 'templates', branchId],
  queryFn: () => shiftsApi.getAll({ branch_id: branchId }),
  enabled: !!branchId,
});

const shiftTemplates: ShiftTemplate[] = shiftsResponse?.items || [];
```

### 4. Added Error Handling ✅
- **Loading state**: Shows spinner while fetching shifts
- **Error state**: Shows alert if API call fails
- **Empty state**: Shows message if no shift templates configured
- **Graceful degradation**: Component doesn't crash if API fails

---

## Files Changed

1. ✅ `apps/web/src/types/index.ts` - Added ShiftTemplate interface
2. ✅ `apps/web/src/api/shifts.ts` - Updated getAll() return type
3. ✅ `apps/web/src/pages/Shifts.tsx` - Replaced hardcoded data with API call

---

## Verification

### TypeScript Compilation ✅
```bash
cd apps/web && npm run type-check
# Result: PASSED (no errors)
```

### Build ✅
```bash
cd apps/web && npm run build
# Result: SUCCESS
# - 2847 modules transformed
# - Build time: 12.73s
# - Bundle: 991.40 KB (gzip: 287.93 KB)
```

### API Endpoint Verified ✅
Backend `GET /api/shifts` endpoint exists and works:
- **Controller**: `ShiftsController.getAllShifts()` (apps/backend/src/modules/shifts/shifts.controller.ts:87-111)
- **Service**: `ShiftsService.getAllShifts()` (apps/backend/src/modules/shifts/shifts.service.ts:63-85)
- **Response**: `{ items: Shift[], total: number, page: number, size: number }`

---

## Pending Evidence (Required Before "Done")

### Browser Test Required:
1. Deploy updated web app to production server
2. Login to https://kuwaitpos.duckdns.org
3. Navigate to Shifts page
4. Verify shifts load from API (not hardcoded)
5. Open browser DevTools Network tab
6. Confirm `GET /api/shifts` request sent
7. Confirm response contains shift templates
8. Screenshot showing:
   - Network request to /api/shifts
   - Shifts displayed on page
   - No hardcoded UUIDs in console

### Acceptance Criteria:
- ✅ Code compiles with no TypeScript errors
- ✅ Build succeeds
- ⏳ Shifts load from API (not hardcoded)
- ⏳ Loading state displays while fetching
- ⏳ Error state displays if API fails
- ⏳ Empty state displays if no shifts configured
- ⏳ Shift open/close flow still works

---

## Rollback Plan

If deployment causes issues:

```bash
# Revert to previous commit
git checkout HEAD~1 apps/web/src/pages/Shifts.tsx apps/web/src/api/shifts.ts apps/web/src/types/index.ts

# Rebuild
cd apps/web && npm run build

# Redeploy
# (follow deployment procedure)
```

---

## Next Steps

1. **Deploy to production** (commit + push + server deploy)
2. **Browser test** (verify shifts load from API)
3. **Document evidence** (screenshot + network log)
4. **Mark task complete** (only after browser evidence)

---

## Notes

- The backend API was already working correctly
- Only frontend needed updates to consume the API
- No database changes required
- No backend changes required
- This fix removes a major technical debt item (hardcoded production data in code)

---

**Status**: Code complete, build verified. Awaiting deployment + browser evidence before marking "Done".
