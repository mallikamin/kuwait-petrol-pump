# Backdated Entries Workflow - Critical Architecture Analysis

## Problem Statement
User wants **100% clean accounting workflow** where:
1. Meter readings (nozzle-wise) reconcile with transactions (product-wise)
2. Finalize day creates sales records and updates inventory
3. No navigation/reload corruption
4. No data loss or fuel type corruption

## Current Architecture (After Investigation)

### Data Model Overview

```
meter_readings (SOURCE OF TRUTH for meter totals)
  ├─ nozzle_id → nozzles → fuel_type_id
  ├─ shift_instance_id → shift_instances → shift_id + date
  ├─ reading_type ('opening' | 'closing')
  └─ meter_value (actual reading)

backdated_entries (OBSOLETE meter readings, just a container now)
  ├─ nozzle_id (for grouping transactions)
  ├─ business_date
  ├─ opening_reading (UNUSED - obsolete after 99e13fd refactor)
  ├─ closing_reading (UNUSED - obsolete after 99e13fd refactor)
  └─ is_finalized (workflow state)

backdated_transactions (ACTUAL SALES DATA)
  ├─ backdated_entry_id (FK to backdated_entries)
  ├─ fuel_type_id (AUTHORITATIVE for accounting)
  ├─ quantity (liters sold)
  └─ line_total (PKR amount)
```

### Critical Finding: Dual Data Source
**BEFORE refactor (99e13fd)**: Meter readings stored in `backdated_entries.opening_reading/closing_reading`
**AFTER refactor (99e13fd)**: Meter readings stored in `meter_readings` table with shift instances

The seed script `scripts/seed-clean-april2.sql` is creating data in the OLD schema (backdated_entries with readings), but the backend reads from the NEW schema (meter_readings table).

### Backend Flow (Current)

```typescript
// 1. Read meter totals from meter_readings table
const dailyMeterReadings = await this.meterReadingsDailyService.getDailyMeterReadings(
  branchId, businessDate, organizationId
);
// This queries: meter_readings → shift_instances → nozzles → fuel_types

// 2. Aggregate meter totals by fuel type
nozzleMeterLiters.set(nozzle.nozzleId, closing - opening);
if (nozzle.fuelType === 'HSD') hsdMeterLiters += liters;
if (nozzle.fuelType === 'PMG') pmgMeterLiters += liters;

// 3. Read transaction totals from backdated_transactions
const allTransactions = entries.flatMap(e => e.transactions);
allTransactions.forEach(txn => {
  if (txn.fuelCode === 'HSD') hsdPostedLiters += txn.quantity;
  if (txn.fuelCode === 'PMG') pmgPostedLiters += txn.quantity;
});

// 4. Calculate gap
const hsdGap = hsdMeterLiters - hsdPostedLiters;
const pmgGap = pmgMeterLiters - pmgPostedLiters;

// 5. Finalize day (when gap = 0)
// - Create sales records (Sale + FuelSale)
// - Queue QB sync
// - Mark entries as finalized
```

### The Core Bug Pattern (Fixed in 9cb8052)
**Problem**: Backend was resolving `fuelTypeId` from **nozzle.fuelTypeId** instead of **transaction.fuelCode**
**Impact**: Walk-in transactions used placeholder nozzle's fuel type → all became HSD
**Fix**: Resolve fuel type from transaction's fuelCode (authoritative), validate against nozzle fuel type (consistency check)

## What Needs to Happen for Clean Room Test

### Option 1: Fix Seed Script (Use meter_readings Table) ✅ CORRECT
Create proper data structure matching current backend:

```sql
-- 1. Create shift instances for the date
INSERT INTO shift_instances (id, shift_id, branch_id, date, status)
VALUES (...);

-- 2. Create meter readings (opening + closing for each nozzle)
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value)
VALUES
  ('D1N1-HSD', shift_instance_id, 'opening', 0),
  ('D1N1-HSD', shift_instance_id, 'closing', 400),
  ('D1N2-HSD', shift_instance_id, 'opening', 0),
  ('D1N2-HSD', shift_instance_id, 'closing', 350),
  -- ... etc

-- 3. Create backdated entries (just containers, no opening/closing)
INSERT INTO backdated_entries (nozzle_id, branch_id, business_date)
VALUES (...);

-- 4. Create transactions with correct fuel_type_id
INSERT INTO backdated_transactions (backdated_entry_id, fuel_type_id, quantity, ...)
VALUES (...);
```

### Option 2: Backend Fallback (Read from backdated_entries if meter_readings empty)
Modify `daily.service.ts` to:
1. Try reading from `meter_readings` first
2. If empty, fallback to `backdated_entries.opening_reading/closing_reading`

**DECISION**: Option 1 is correct. Option 2 would perpetuate obsolete schema.

## Action Plan

### STEP 1: Discover Shift Configuration
Query production DB to find existing shifts for the branch:

```sql
SELECT id, name, shift_number, start_time, end_time
FROM shifts
WHERE branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
ORDER BY shift_number;
```

### STEP 2: Rewrite Seed Script
Create `scripts/seed-clean-april2-v2.sql` with:
1. Shift instances for April 2
2. Meter readings (opening/closing) for all nozzles
3. Backdated entries (minimal, just for transaction grouping)
4. Transactions with correct fuel_type_id

### STEP 3: Execute & Verify
1. Run seed script on production DB
2. Verify meter totals: `GET /api/backdated-entries/daily?branchId=X&businessDate=2026-04-02`
3. Expected: HSD meter=1100, posted=1100, gap=0; PMG meter=1250, posted=1250, gap=0

### STEP 4: Workflow Tests
1. Navigation stability (reload 3x, verify totals unchanged)
2. Finalize day (verify sales created, day marked finalized)
3. Reports sync (verify sales appear in reports)

## Files to Fix
- `scripts/seed-clean-april2.sql` → DELETE (wrong schema)
- `scripts/seed-clean-april2-v2.sql` → CREATE (correct schema with meter_readings)

## Critical Rules
1. **Meter readings** = single source of truth for meter totals (from `meter_readings` table)
2. **Transaction fuel_type_id** = authoritative for accounting (from `backdated_transactions`)
3. **Nozzle-fuel consistency** = backend validation (reject mismatches with 409)
4. **Backdated entries** = just containers for transactions (opening/closing readings obsolete)
