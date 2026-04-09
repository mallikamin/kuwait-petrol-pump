-- Repair Script: April 2 Fuel Type Corruption
-- Date: 2026-04-09
-- Issue: 2 transactions recorded with PMG fuel_type_id but assigned to HSD nozzle
-- Root Cause: Backend ignored txn.fuelCode, always used nozzle.fuelTypeId (fixed in commit 9cb8052)

-- BACKUP VERIFICATION (run first)
-- Verify backup exists: ls -lh /root/backups/pre-apr2-repair-*.gz

BEGIN;

-- Step 1: Verify current corrupted state
SELECT
  bt.id,
  be.nozzle_id,
  n.name as nozzle_name,
  fn.code as nozzle_fuel,
  ft.code as txn_fuel,
  bt.quantity,
  bt.unit_price,
  bt.product_name,
  CASE WHEN fn.code = ft.code THEN 'OK' ELSE 'MISMATCH' END as status
FROM backdated_transactions bt
JOIN backdated_entries be ON bt.backdated_entry_id = be.id
JOIN nozzles n ON be.nozzle_id = n.id
JOIN fuel_types fn ON n.fuel_type_id = fn.id
JOIN fuel_types ft ON bt.fuel_type_id = ft.id
WHERE bt.id IN (
  'feba6d9b-edfa-4b01-b81e-52472b524952',  -- ABC customer, 300L, D1N1-HSD nozzle, PMG fuel_type_id
  'd072423a-a2ee-4f5a-9e06-4f6caa9ee4f3'   -- ABDULLAH FLOUR, 490L, D1N1-HSD nozzle, PMG fuel_type_id
);

-- Expected output: 2 MISMATCH rows

-- Step 2: Get HSD fuel type ID
-- (HSD = a2222222-2222-2222-2222-222222222222)
SELECT id, code, name FROM fuel_types WHERE code = 'HSD';

-- Step 3: Repair corrupted transactions (change PMG → HSD)
UPDATE backdated_transactions
SET
  fuel_type_id = 'a2222222-2222-2222-2222-222222222222',  -- HSD fuel type ID
  product_name = 'High Speed Diesel',  -- Correct product name
  updated_at = NOW()
WHERE id IN (
  'feba6d9b-edfa-4b01-b81e-52472b524952',
  'd072423a-a2ee-4f5a-9e06-4f6caa9ee4f3'
);

-- Step 4: Verify repair (should show OK for both)
SELECT
  bt.id,
  be.nozzle_id,
  n.name as nozzle_name,
  fn.code as nozzle_fuel,
  ft.code as txn_fuel,
  bt.quantity,
  bt.unit_price,
  bt.product_name,
  CASE WHEN fn.code = ft.code THEN 'OK' ELSE 'MISMATCH' END as status
FROM backdated_transactions bt
JOIN backdated_entries be ON bt.backdated_entry_id = be.id
JOIN nozzles n ON be.nozzle_id = n.id
JOIN fuel_types fn ON n.fuel_type_id = fn.id
JOIN fuel_types ft ON bt.fuel_type_id = ft.id
WHERE bt.id IN (
  'feba6d9b-edfa-4b01-b81e-52472b524952',
  'd072423a-a2ee-4f5a-9e06-4f6caa9ee4f3'
);

-- Expected output: 2 OK rows

-- Step 5: Verify totals (should be HSD 2600L, PMG 1250L)
SELECT
  ft.code as fuel_code,
  COUNT(*) as txn_count,
  SUM(bt.quantity) as total_liters
FROM backdated_transactions bt
JOIN backdated_entries be ON bt.backdated_entry_id = be.id
JOIN fuel_types ft ON bt.fuel_type_id = ft.id
WHERE be.branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
  AND be.business_date = '2026-04-02'
GROUP BY ft.code
ORDER BY ft.code;

-- Expected output:
-- HSD | 11 | 2600.000
-- PMG |  2 | 1250.000  (NOT 790!)

COMMIT;

-- ROLLBACK;  -- Uncomment if verification fails
