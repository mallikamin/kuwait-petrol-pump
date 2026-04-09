-- Clean Room Seed Script v2: April 2, 2026 (CORRECT SCHEMA)
-- Uses meter_readings table (current backend), NOT backdated_entries readings (obsolete)
-- Branch: Main Branch (9bcb8674-9d93-4d93-b0fc-270305dcbe50)
-- Date: 2026-04-02
-- Expected Totals: HSD 1100L, PMG 1250L

BEGIN;

-- Constants
\set branch_id '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
\set business_date '2026-04-02'
\set admin_user_id 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
\set day_shift_id '2cf99710-4971-4357-9673-d5f1ebf4d256'

-- Nozzle IDs
\set d1n1_hsd '6412462b-19d8-4168-8cbd-d1274990f6c7'
\set d1n2_hsd '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426'
\set d2n1_hsd 'f1e5e5cf-2d7e-4770-9330-078517d99eae'
\set d3n1_pmg '834c1f12-ab71-431f-b0fd-cb536444335d'
\set d4n1_pmg '5c5360cf-0ffa-44a6-9890-53fee1205f49'
\set d4n2_pmg '5022dc79-f077-4f4c-acf2-5a436c9bad79'

-- Fuel type IDs
\set hsd_fuel_id 'a2222222-2222-2222-2222-222222222222'
\set pmg_fuel_id 'a1111111-1111-1111-1111-111111111111'

-- Customer IDs
\set customer_abc '8eaa02be-7797-46ff-a6f0-74bb2aba7493'
\set customer_abdullah 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe'
\set customer_test_creation 'ffee5460-62a1-4dd4-89cd-14144dea2384'
\set customer_test '3d88482e-f4ff-4959-ba6a-562df6a9f256'
\set customer_test_customer '6fcddde0-3621-41b1-89f7-fce8ae665489'

-----------------------------------------------------------
-- STEP 1: Create Shift Instance for April 2, Day Shift
-----------------------------------------------------------
INSERT INTO shift_instances (id, shift_id, branch_id, date, status, opened_at, opened_by)
VALUES (
  gen_random_uuid(),
  '2cf99710-4971-4357-9673-d5f1ebf4d256',
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  'closed',
  '2026-04-02 06:00:00+00',
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS shift_instance_id \gset

\echo 'Created shift instance:' :shift_instance_id

-----------------------------------------------------------
-- STEP 2: Create Meter Readings (Opening + Closing for Each Nozzle)
-----------------------------------------------------------

-- D1N1-HSD: 0 → 400L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('6412462b-19d8-4168-8cbd-d1274990f6c7', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('6412462b-19d8-4168-8cbd-d1274990f6c7', :'shift_instance_id', 'closing', 400, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D1N2-HSD: 0 → 350L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', :'shift_instance_id', 'closing', 350, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D2N1-HSD: 0 → 350L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('f1e5e5cf-2d7e-4770-9330-078517d99eae', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('f1e5e5cf-2d7e-4770-9330-078517d99eae', :'shift_instance_id', 'closing', 350, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D3N1-PMG: 0 → 500L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('834c1f12-ab71-431f-b0fd-cb536444335d', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('834c1f12-ab71-431f-b0fd-cb536444335d', :'shift_instance_id', 'closing', 500, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N1-PMG: 0 → 450L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('5c5360cf-0ffa-44a6-9890-53fee1205f49', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('5c5360cf-0ffa-44a6-9890-53fee1205f49', :'shift_instance_id', 'closing', 450, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N2-PMG: 0 → 300L
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
VALUES
  ('5022dc79-f077-4f4c-acf2-5a436c9bad79', :'shift_instance_id', 'opening', 0, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('5022dc79-f077-4f4c-acf2-5a436c9bad79', :'shift_instance_id', 'closing', 300, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

\echo 'Created 12 meter readings (6 nozzles × 2 types each)'

-----------------------------------------------------------
-- STEP 3: Create Backdated Entries (Containers for Transactions)
-----------------------------------------------------------

-- D1N1-HSD Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '6412462b-19d8-4168-8cbd-d1274990f6c7',
  NULL,
  0, 0, -- obsolete fields, but required by schema
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d1n1_entry_id \gset

-- D1N1-HSD Transactions (200 + 150 + 50 = 400L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d1n1_entry_id', '8eaa02be-7797-46ff-a6f0-74bb2aba7493', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 200, 300.00, 60000.00, 'cash', '2026-04-02 08:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (:'d1n1_entry_id', 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 150, 300.00, 45000.00, 'credit_customer', '2026-04-02 09:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (:'d1n1_entry_id', NULL, 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 50, 300.00, 15000.00, 'cash', '2026-04-02 10:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D1N2-HSD Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426',
  NULL,
  0, 0,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d1n2_entry_id \gset

-- D1N2-HSD Transactions (350L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d1n2_entry_id', 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'bank_card', '2026-04-02 11:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D2N1-HSD Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  'f1e5e5cf-2d7e-4770-9330-078517d99eae',
  NULL,
  0, 0,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d2n1_entry_id \gset

-- D2N1-HSD Transactions (350L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d2n1_entry_id', '3d88482e-f4ff-4959-ba6a-562df6a9f256', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'cash', '2026-04-02 12:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D3N1-PMG Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '834c1f12-ab71-431f-b0fd-cb536444335d',
  NULL,
  0, 0,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d3n1_entry_id \gset

-- D3N1-PMG Transactions (300 + 200 = 500L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d3n1_entry_id', '8eaa02be-7797-46ff-a6f0-74bb2aba7493', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 300, 321.17, 96351.00, 'credit_customer', '2026-04-02 13:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (:'d3n1_entry_id', 'a2fd4706-f92a-4b36-b3c3-501cd95cabbe', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 200, 321.17, 64234.00, 'cash', '2026-04-02 14:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N1-PMG Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '5c5360cf-0ffa-44a6-9890-53fee1205f49',
  NULL,
  0, 0,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d4n1_entry_id \gset

-- D4N1-PMG Transactions (450L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d4n1_entry_id', 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 450, 321.17, 144526.50, 'bank_card', '2026-04-02 15:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N2-PMG Entry
INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, shift_id, opening_reading, closing_reading, is_finalized, created_by)
VALUES (
  gen_random_uuid(),
  '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
  '2026-04-02',
  '5022dc79-f077-4f4c-acf2-5a436c9bad79',
  NULL,
  0, 0,
  false,
  'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
) RETURNING id AS d4n2_entry_id \gset

-- D4N2-PMG Transactions (150 + 150 = 300L)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES
  (:'d4n2_entry_id', NULL, 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 150, 321.17, 48175.50, 'cash', '2026-04-02 16:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  (:'d4n2_entry_id', '6fcddde0-3621-41b1-89f7-fce8ae665489', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 150, 321.17, 48175.50, 'credit_customer', '2026-04-02 17:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

\echo 'Created 6 backdated entries + 10 transactions'

-----------------------------------------------------------
-- VERIFICATION
-----------------------------------------------------------

\echo ''
\echo '=== SEED VERIFICATION ==='
\echo ''

-- Verify meter totals (from meter_readings table - AUTHORITATIVE)
\echo 'Meter Totals (from meter_readings table):'
SELECT
  ft.code as fuel_type,
  COUNT(DISTINCT mr.nozzle_id) as nozzle_count,
  SUM(CASE WHEN mr.reading_type = 'closing' THEN mr.meter_value ELSE -mr.meter_value END) as total_liters
FROM meter_readings mr
JOIN nozzles n ON mr.nozzle_id = n.id
JOIN fuel_types ft ON n.fuel_type_id = ft.id
JOIN shift_instances si ON mr.shift_instance_id = si.id
WHERE si.branch_id = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'
  AND si.date = '2026-04-02'
GROUP BY ft.code
ORDER BY ft.code;

-- Verify posted totals (from backdated_transactions)
\echo ''
\echo 'Posted Totals (from backdated_transactions):'
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
