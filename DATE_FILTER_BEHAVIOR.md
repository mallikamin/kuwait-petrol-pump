# Date Filter Behavior in Sales API

## Current Behavior (As of 8aeb0a5)

### Endpoint
`GET /api/sales?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

### Issue: endDate is Effectively Exclusive

**Root Cause**: The schema parses date strings as ISO datetime, defaulting to midnight (00:00:00 UTC). When using `lte` (less than or equal) with midnight, it excludes the entire day.

**Example**:
```
startDate=2026-04-02
endDate=2026-04-02
```

- `startDate` → `2026-04-02T00:00:00Z` → `saleDate >= 2026-04-02T00:00:00Z` ✅ Includes April 2
- `endDate` → `2026-04-02T00:00:00Z` → `saleDate <= 2026-04-02T00:00:00Z` ❌ Excludes April 2 (only midnight)

**Result**: Returns 0 records for April 2 when `endDate=2026-04-02`.

### Workaround (Current)

Add 1 day to endDate:
```
GET /api/sales?startDate=2026-04-02&endDate=2026-04-03
```
This includes all of April 2 (midnight to midnight).

## Recommended Fix

### Option 1: Adjust endDate to End-of-Day (Simple)

In `sales.service.ts`, adjust endDate to 23:59:59.999:

```typescript
if (endDate) {
  // Adjust to end of day (23:59:59.999) to make date-only endDate inclusive
  const adjustedEndDate = new Date(endDate);
  adjustedEndDate.setHours(23, 59, 59, 999);
  (where.saleDate as Record<string, Date>).lte = adjustedEndDate;
}
```

### Option 2: Use `lt` with +1 Day (Recommended)

```typescript
if (endDate) {
  // Add 1 day and use `lt` (less than) instead of `lte` for inclusive date range
  const nextDay = new Date(endDate);
  nextDay.setDate(nextDay.getDate() + 1);
  (where.saleDate as Record<string, Date>).lt = nextDay;
}
```

**Why Option 2 is better**: Avoids DST/timezone edge cases with 23:59:59.999.

## Product Expectation

**User expectation**: When filtering by `endDate=2026-04-02`, users expect to see all sales from April 2 (inclusive), not just sales at midnight.

**Recommendation**: Patch the backend with Option 2 to match user expectations.

## Files Affected

- `apps/backend/src/modules/sales/sales.service.ts` (lines 287, 415)
- `apps/backend/src/modules/reports/reports.service.ts` (similar pattern if exists)

## Testing

After patching:
```bash
# Should return April 2 sales (currently returns 0, should return 10 after fix)
curl -H "Authorization: Bearer TOKEN" \
  "https://kuwaitpos.duckdns.org/api/sales?startDate=2026-04-02&endDate=2026-04-02&branchId=..."
```

## Status

- **Documented**: 2026-04-09 15:03 UTC
- **Patched**: ❌ Not yet (workaround: add +1 day to endDate in frontend)
- **Priority**: P2 (UX improvement, not blocking)
