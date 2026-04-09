-- Clean Room Seed Script v3: April 2, 2026 (No psql variables, pure SQL)
-- Uses meter_readings table (current backend), NOT backdated_entries readings (obsolete)
-- Branch: Main Branch
-- Date: 2026-04-02
-- Expected Totals: HSD 1100L, PMG 1250L

BEGIN;

-- Step 1: Create shift instance and capture its ID
WITH new_shift AS (
  INSERT INTO shift_instances (id, shift_id, branch_id, date, status, opened_at, opened_by)
  VALUES (
    gen_random_uuid(),
    '2cf99710-4971-4357-9673-d5f1ebf4d256', -- Day Shift
    '9bcb8674-9d93-4d93-b0fc-270305dcbe50', -- Main Branch
    '2026-04-02',
    'closed',
    '2026-04-02 06:00:00+00',
    'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f' -- Admin user
  )
  RETURNING id
)
-- Step 2: Create all meter readings using the shift instance ID
INSERT INTO meter_readings (nozzle_id, shift_instance_id, reading_type, meter_value, recorded_by, submitted_by)
SELECT nozzle_id, (SELECT id FROM new_shift), reading_type, meter_value, user_id, user_id
FROM (VALUES
  -- D1N1-HSD: 0 → 400L
  ('6412462b-19d8-4168-8cbd-d1274990f6c7', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('6412462b-19d8-4168-8cbd-d1274990f6c7', 'closing', 400::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  -- D1N2-HSD: 0 → 350L
  ('9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', 'closing', 350::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  -- D2N1-HSD: 0 → 350L
  ('f1e5e5cf-2d7e-4770-9330-078517d99eae', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('f1e5e5cf-2d7e-4770-9330-078517d99eae', 'closing', 350::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  -- D3N1-PMG: 0 → 500L
  ('834c1f12-ab71-431f-b0fd-cb536444335d', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('834c1f12-ab71-431f-b0fd-cb536444335d', 'closing', 500::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  -- D4N1-PMG: 0 → 450L
  ('5c5360cf-0ffa-44a6-9890-53fee1205f49', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('5c5360cf-0ffa-44a6-9890-53fee1205f49', 'closing', 450::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  -- D4N2-PMG: 0 → 300L
  ('5022dc79-f077-4f4c-acf2-5a436c9bad79', 'opening', 0::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'),
  ('5022dc79-f077-4f4c-acf2-5a436c9bad79', 'closing', 300::numeric, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
) AS t(nozzle_id, reading_type, meter_value, user_id);

-- Step 3: Create backdated entries + transactions

-- D1N1-HSD Entry + Transactions (200 + 150 + 50 = 400L)
WITH d1n1_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (
    gen_random_uuid(),
    '9bcb8674-9d93-4d93-b0fc-270305dcbe50',
    '2026-04-02',
    '6412462b-19d8-4168-8cbd-d1274990f6c7',
    0, 0, -- obsolete fields
    false,
    'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'
  )
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
SELECT (SELECT id FROM d1n1_entry), customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id
FROM (VALUES
  ('8eaa02be-7797-46ff-a6f0-74bb2aba7493'::uuid, 'a2222222-2222-2222-2222-222222222222'::uuid, 'High Speed Diesel', 200::numeric, 300.00::numeric, 60000.00::numeric, 'cash', '2026-04-02 08:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid),
  ('a2fd4706-f92a-4b36-b3c3-501cd95cabbe'::uuid, 'a2222222-2222-2222-2222-222222222222'::uuid, 'High Speed Diesel', 150::numeric, 300.00::numeric, 45000.00::numeric, 'credit_customer', '2026-04-02 09:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid),
  (NULL::uuid, 'a2222222-2222-2222-2222-222222222222'::uuid, 'High Speed Diesel', 50::numeric, 300.00::numeric, 15000.00::numeric, 'cash', '2026-04-02 10:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid)
) AS t(customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id);

-- D1N2-HSD Entry + Transaction (350L)
WITH d1n2_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (gen_random_uuid(), '9bcb8674-9d93-4d93-b0fc-270305dcbe50', '2026-04-02', '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', 0, 0, false, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES ((SELECT id FROM d1n2_entry), 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'bank_card', '2026-04-02 11:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D2N1-HSD Entry + Transaction (350L)
WITH d2n1_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (gen_random_uuid(), '9bcb8674-9d93-4d93-b0fc-270305dcbe50', '2026-04-02', 'f1e5e5cf-2d7e-4770-9330-078517d99eae', 0, 0, false, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES ((SELECT id FROM d2n1_entry), '3d88482e-f4ff-4959-ba6a-562df6a9f256', 'a2222222-2222-2222-2222-222222222222', 'High Speed Diesel', 350, 300.00, 105000.00, 'cash', '2026-04-02 12:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D3N1-PMG Entry + Transactions (300 + 200 = 500L)
WITH d3n1_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (gen_random_uuid(), '9bcb8674-9d93-4d93-b0fc-270305dcbe50', '2026-04-02', '834c1f12-ab71-431f-b0fd-cb536444335d', 0, 0, false, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
SELECT (SELECT id FROM d3n1_entry), customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id
FROM (VALUES
  ('8eaa02be-7797-46ff-a6f0-74bb2aba7493'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Premium Motor Gasoline', 300::numeric, 321.17::numeric, 96351.00::numeric, 'credit_customer', '2026-04-02 13:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid),
  ('a2fd4706-f92a-4b36-b3c3-501cd95cabbe'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Premium Motor Gasoline', 200::numeric, 321.17::numeric, 64234.00::numeric, 'cash', '2026-04-02 14:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid)
) AS t(customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id);

-- D4N1-PMG Entry + Transaction (450L)
WITH d4n1_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (gen_random_uuid(), '9bcb8674-9d93-4d93-b0fc-270305dcbe50', '2026-04-02', '5c5360cf-0ffa-44a6-9890-53fee1205f49', 0, 0, false, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
VALUES ((SELECT id FROM d4n1_entry), 'ffee5460-62a1-4dd4-89cd-14144dea2384', 'a1111111-1111-1111-1111-111111111111', 'Premium Motor Gasoline', 450, 321.17, 144526.50, 'bank_card', '2026-04-02 15:00:00+00', 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f');

-- D4N2-PMG Entry + Transactions (150 + 150 = 300L)
WITH d4n2_entry AS (
  INSERT INTO backdated_entries (id, branch_id, business_date, nozzle_id, opening_reading, closing_reading, is_finalized, created_by)
  VALUES (gen_random_uuid(), '9bcb8674-9d93-4d93-b0fc-270305dcbe50', '2026-04-02', '5022dc79-f077-4f4c-acf2-5a436c9bad79', 0, 0, false, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f')
  RETURNING id
)
INSERT INTO backdated_transactions (backdated_entry_id, customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, created_by)
SELECT (SELECT id FROM d4n2_entry), customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id
FROM (VALUES
  (NULL::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Premium Motor Gasoline', 150::numeric, 321.17::numeric, 48175.50::numeric, 'cash', '2026-04-02 16:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid),
  ('6fcddde0-3621-41b1-89f7-fce8ae665489'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Premium Motor Gasoline', 150::numeric, 321.17::numeric, 48175.50::numeric, 'credit_customer', '2026-04-02 17:00:00+00'::timestamptz, 'a89d3495-8e8d-4eaf-8c03-2ea2de600c0f'::uuid)
) AS t(customer_id, fuel_type_id, product_name, quantity, unit_price, line_total, payment_method, transaction_datetime, user_id);

-- Verification queries
\echo ''
\echo '=== SEED VERIFICATION ==='
\echo ''
\echo 'Meter Totals (from meter_readings table - AUTHORITATIVE):'
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
