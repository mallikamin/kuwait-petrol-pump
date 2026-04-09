-- Clean Room Seed Script: April 2, 2026
-- Deterministic test case matching meter readings exactly
-- Branch: Main Branch (9bcb8674-9d93-4d93-b0fc-270305dcbe50)
-- Date: 2026-04-02
-- Expected Totals: HSD 1100L, PMG 1250L

BEGIN;

-- Get user ID for created_by/updated_by
\set admin_user_id 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'

-- Get nozzle IDs
\set d1n1_hsd '6412462b-19d8-4168-8cbd-d1274990f6c7'
\set d1n2_hsd '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426'
\set d2n1_hsd 'f1e5e5cf-2d7e-4770-9330-078517d99eae'
\set d3n1_pmg '834c1f12-ab71-431f-b0fd-cb536444335d'
\set d4n1_pmg '5c5360cf-0ffa-44a6-9890-53fee1205f49'
\set d4n2_pmg '5022dc79-f077-4f4c-acf2-5a436c9bad79'

-- Get fuel type IDs
\set hsd_fuel_id 'a2222222-2222-2222-2222-222222222222'
\set pmg_fuel_id 'a1111111-1111-1111-1111-111111111111'

-- Get customer IDs (use existing test customers)
\set customer_a '8eaa02be-7797-46ff-a6f0-74bb2aba7493'  -- ABC
\set customer_b 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe'  -- ABDULLAH FLOUR MILLS
\set customer_c 'ffee5460-62a1-4dd4-89cd-14144dea2384'  -- TestCreation
\set customer_d '3d88482e-f4ff-4959-ba6a-562df6a9f256'  -- Test
\set customer_e '6fcddde0-3621-41b1-89f7-fce8ae665489'  -- Test Customer

-----------------------------------------------------------
-- HSD NOZZLES (Total: 1100L)
-----------------------------------------------------------

-- D1N1-HSD Entry (400L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '6412462b-19d8-4168-8cbd-d1274990f6c7',
  NULL,
  0,
  400,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d1n1_entry_id \gset

-- D1N1-HSD Transactions (200 + 150 + 50 = 400L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d1n1_entry_id', '8eaa02be-7797-46ff-a6f0-74bb2aba7493', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 200, 300.00, 60000.00, 'cash', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (gen_random_uuid(), :'d1n1_entry_id', 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 150, 300.00, 45000.00, 'credit_customer', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (gen_random_uuid(), :'d1n1_entry_id', NULL, 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 50, 300.00, 15000.00, 'cash', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D1N2-HSD Entry (350L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426',
  NULL,
  0,
  350,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d1n2_entry_id \gset

-- D1N2-HSD Transactions (350L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d1n2_entry_id', 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'bank_card', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D2N1-HSD Entry (350L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  'f1e5e5cf-2d7e-4770-9330-078517d99eae',
  NULL,
  0,
  350,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d2n1_entry_id \gset

-- D2N1-HSD Transactions (350L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d2n1_entry_id', '3d88482e-f4ff-4959-ba6a-562df6a9f256', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'cash', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-----------------------------------------------------------
-- PMG NOZZLES (Total: 1250L)
-----------------------------------------------------------

-- D3N1-PMG Entry (500L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '834c1f12-ab71-431f-b0fd-cb536444335d',
  NULL,
  0,
  500,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d3n1_entry_id \gset

-- D3N1-PMG Transactions (300 + 200 = 500L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d3n1_entry_id', '8eaa02be-7797-46ff-a6f0-74bb2aba7493', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 300, 321.17, 96351.00, 'credit_customer', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (gen_random_uuid(), :'d3n1_entry_id', 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 200, 321.17, 64234.00, 'cash', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N1-PMG Entry (450L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '5c5360cf-0ffa-44a6-9890-53fee1205f49',
  NULL,
  0,
  450,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d4n1_entry_id \gset

-- D4N1-PMG Transactions (450L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d4n1_entry_id', 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 450, 321.17, 144526.50, 'bank_card', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N2-PMG Entry (300L metered)
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_reconciled, created_by, updated_by, is_finalized)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '5022dc79-f077-4f4c-acf2-5a436c9bad79',
  NULL,
  0,
  300,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f',
  false
) RETURNING id AS d4n2_entry_id \gset

-- D4N2-PMG Transactions (150 + 150 = 300L)
INSERT INTO backdated_transactions (id, backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by, updated_by)
VALUES
  (gen_random_uuid(), :'d4n2_entry_id', NULL, 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 150, 321.17, 48175.50, 'cash', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (gen_random_uuid(), :'d4n2_entry_id', '6fcddde0-3621-41b1-89f7-fce8ae665489', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 150, 321.17, 48175.50, 'credit_customer', '2026-04-02', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-----------------------------------------------------------
-- VERIFICATION
-----------------------------------------------------------

\echo ''
\echo '=== SEED VERIFICATION ==='

-- Verify meter totals by fuel type
\echo ''
\echo 'Meter Totals (Nozzle-Wise Aggregation):'
SELECT
  ft.code as fuel_type,
  COUNT(DISTINCT be.nozzle_id) as nozzle_count,
  SUM(be.closing_reading - be.opening_reading) as total_liters
FROM backdated_entries be
JOIN nozzles n ON be.nozzle_id = n.id
JOIN fuel_types ft ON n.fuel_type_id = ft.id
WHERE be.branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
  AND be.business_date = '2026-04-02'
GROUP BY ft.code
ORDER BY ft.code;

-- Verify posted totals by transaction fuel type
\echo ''
\echo 'Posted Totals (Transaction Fuel Type):'
SELECT
  ft.code as fuel_type,
  COUNT(*) as transaction_count,
  SUM(bt.quantity) as total_liters,
  SUM(bt.line_total) as total_amount
FROM backdated_transactions bt
JOIN backdated_entries be ON bt.backdated_entry_id = be.id
JOIN fuel_types ft ON bt.fuel_type_id = ft.id
WHERE be.branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
  AND be.business_date = '2026-04-02'
GROUP BY ft.code
ORDER BY ft.code;

-- Verify nozzle-fuel consistency
\echo ''
\echo 'Nozzle-Fuel Consistency Check:'
SELECT
  COUNT(*) as total_transactions,
  SUM(CASE WHEN nozzle_fuel.code = txn_fuel.code THEN 1 ELSE 0 END) as matching,
  SUM(CASE WHEN nozzle_fuel.code != txn_fuel.code THEN 1 ELSE 0 END) as mismatches
FROM backdated_transactions bt
JOIN backdated_entries be ON bt.backdated_entry_id = be.id
JOIN nozzles n ON be.nozzle_id = n.id
JOIN fuel_types nozzle_fuel ON n.fuel_type_id = nozzle_fuel.id
JOIN fuel_types txn_fuel ON bt.fuel_type_id = txn_fuel.id
WHERE be.branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
  AND be.business_date = '2026-04-02';

\echo ''
\echo 'Expected: Meter HSD=1100, PMG=1250 | Posted HSD=1100, PMG=1250 | Mismatches=0'

COMMIT;
