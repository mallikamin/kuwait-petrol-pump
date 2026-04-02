-- Import Real Customers and Configure Dispensing Units
-- Run this in the PostgreSQL database

-- Step 1: Delete existing demo customers (except Walk-in)
DELETE FROM "Customer" WHERE name LIKE 'XYZ%' OR name LIKE 'ABC%' OR name LIKE 'PQR%';

-- Step 2: Get organization and branch IDs (update these with actual IDs from your database)
-- Run this first to get the IDs:
-- SELECT id, name FROM "Organization";
-- SELECT id, name, "organizationId" FROM "Branch";

-- For this script, we'll use variables (replace with actual values)
-- Assuming organizationId and branchId from the first records

-- Step 3: Import customers
-- Note: Update the UUIDs below with your actual organization ID

INSERT INTO "Customer" (id, name, phone, email, address, "creditLimit", "currentBalance", "organizationId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  customer_name,
  '+92-300-0000000',
  NULL,
  NULL,
  0,
  0,
  (SELECT id FROM "Organization" LIMIT 1),
  NOW(),
  NOW()
FROM (VALUES
  ('6222-LES CREATIVE ELECTRONICS'),
  ('ABDULLAH FLOUR MILLS PVT LTD'),
  ('ABL Bank Staff'),
  ('ABUZAR GRINDING MILL (PVT) LIMITED'),
  ('AL-MUKHTAR FLOUR& GENERAL MILLS'),
  ('AL FAISAL GOODS TRANSPORT COMPANY'),
  ('AL HARAM TRANSPORT'),
  ('AL WAHAB FLOUR MILL'),
  ('ALI SARWR JAZZ TOWER COMPANY'),
  ('ALLMED (PVT) LTD'),
  ('AR FILLING STATION'),
  ('ARABIA ROLLER FLOUR MILL'),
  ('ATALFA CO'),
  ('ATTOCK PUMP'),
  ('AVANZA HEALTH CARE'),
  ('Bank Card Receiveable'),
  ('BARAKA FLOUR MILLS.'),
  ('BB CHEMPAK INDUSTRIES (PVT) LTD.'),
  ('BIN RASHEED'),
  ('BISMILLAH FILLING STATION'),
  ('BOARD OF MANAGEMENT SIE'),
  ('CH IBRAHIM PETROL PUMP'),
  ('CHADUHARY ABDULLAH TRANSPORT CO.'),
  ('CREATIVE  ELECTRONICS (PVT) LTD.'),
  ('DANEWAL COACHES'),
  ('ENFRASHARE JAZZ COMPANY'),
  ('FINE FIBER COMPANY'),
  ('G T & D PRIVATE LIMITED'),
  ('GOLDEN FOODS PVT LTD'),
  ('GREEN TOURS RENT A CAR'),
  ('HOEST COMPANY'),
  ('HORIZON HEALTH CARE (PVT) LTD.'),
  ('HSD gain/loss'),
  ('IMPERIAL FLOUR MILL'),
  ('IMPEX FREIGHT SYSTEM'),
  ('JAMSHAID KPP-4621'),
  ('JAWA FOODS RAIWIND'),
  ('JAZZ TOWER COMPANY'),
  ('KAMAL ZIMINDAR FLOUR MILL'),
  ('KANSAI PAINT'),
  ('LASANI GROUP COMPANY (MUMTAZ SB)'),
  ('MADINA FILLING STATION'),
  ('MATRIX'),
  ('MEHRAN PLASTIC INDUSTIRES (PVT) LTD'),
  ('MON SALWA FACTORY'),
  ('NASEER PAPER AND BOARD MILL (PVT) L'),
  ('NAVEED WAZIR ALI (LPG)'),
  ('PARK VIEW LEDGER'),
  ('PERFECT TRANSPORT NETWORK CO'),
  ('PHARMA SOLE'),
  ('PMG gain/loss'),
  ('PROGRESSIVE ENGINEERING CO'),
  ('PSO Card Receivables'),
  ('PSO incentives'),
  ('Rawi Autos'),
  ('ROSHAN PACKAGES COMPANY'),
  ('SAMRAH ENTERPRISES'),
  ('SHAN FOODS (PVT) LTD.'),
  ('SHMZ LABS & PHARMACEUTICALS (PVT) L'),
  ('SIX B FOOD INDUSTRIES (PVT) LTD'),
  ('SUNDAR FLOUR & GENERAL MILLS (PVT)'),
  ('TAIBA GOODS TRANSPORT COMPANY'),
  ('TALK PACK COMPANY'),
  ('THERMOSOLE INDUSTRIES'),
  ('TOURS (LASANI TOURS)'),
  ('ULTRA PACK COMPANY'),
  ('UNITED FILLING STATION'),
  ('VIEGEN PHARMA (PVT) LTD.'),
  ('Walk in customer'),
  ('YOUNAS TRANSPORTER')
) AS t(customer_name)
ON CONFLICT DO NOTHING;

-- Step 4: Configure Dispensing Units
-- First, delete existing nozzles and units for the branch
DELETE FROM "Nozzle" WHERE "dispensingUnitId" IN (
  SELECT id FROM "DispensingUnit" WHERE "branchId" = (SELECT id FROM "Branch" LIMIT 1)
);
DELETE FROM "DispensingUnit" WHERE "branchId" = (SELECT id FROM "Branch" LIMIT 1);

-- Get fuel type IDs
DO $$
DECLARE
  org_id UUID;
  branch_id UUID;
  pmg_id UUID;
  hsd_id UUID;
  unit1_id UUID;
  unit2_id UUID;
  unit3_id UUID;
  unit4_id UUID;
BEGIN
  -- Get IDs
  SELECT id INTO org_id FROM "Organization" LIMIT 1;
  SELECT id INTO branch_id FROM "Branch" WHERE "organizationId" = org_id LIMIT 1;
  SELECT id INTO pmg_id FROM "FuelType" WHERE code = 'PMG';
  SELECT id INTO hsd_id FROM "FuelType" WHERE code = 'HSD';

  -- Create Unit 1 (2 nozzles: PMG + HSD)
  INSERT INTO "DispensingUnit" (id, "unitNumber", name, "branchId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 1, 'Dispenser 1', branch_id, true, NOW(), NOW())
  RETURNING id INTO unit1_id;

  INSERT INTO "Nozzle" (id, "nozzleNumber", "displayName", "fuelTypeId", "dispensingUnitId", "isActive", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid(), 1, 'Unit 1 - Nozzle 1 (PMG)', pmg_id, unit1_id, true, NOW(), NOW()),
    (gen_random_uuid(), 2, 'Unit 1 - Nozzle 2 (HSD)', hsd_id, unit1_id, true, NOW(), NOW());

  -- Create Unit 2 (1 nozzle: HSD)
  INSERT INTO "DispensingUnit" (id, "unitNumber", name, "branchId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 2, 'Dispenser 2', branch_id, true, NOW(), NOW())
  RETURNING id INTO unit2_id;

  INSERT INTO "Nozzle" (id, "nozzleNumber", "displayName", "fuelTypeId", "dispensingUnitId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 1, 'Unit 2 - Nozzle 1 (HSD)', hsd_id, unit2_id, true, NOW(), NOW());

  -- Create Unit 3 (1 nozzle: PMG)
  INSERT INTO "DispensingUnit" (id, "unitNumber", name, "branchId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 3, 'Dispenser 3', branch_id, true, NOW(), NOW())
  RETURNING id INTO unit3_id;

  INSERT INTO "Nozzle" (id, "nozzleNumber", "displayName", "fuelTypeId", "dispensingUnitId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 1, 'Unit 3 - Nozzle 1 (PMG)', pmg_id, unit3_id, true, NOW(), NOW());

  -- Create Unit 4 (2 nozzles: PMG + HSD)
  INSERT INTO "DispensingUnit" (id, "unitNumber", name, "branchId", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 4, 'Dispenser 4', branch_id, true, NOW(), NOW())
  RETURNING id INTO unit4_id;

  INSERT INTO "Nozzle" (id, "nozzleNumber", "displayName", "fuelTypeId", "dispensingUnitId", "isActive", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid(), 1, 'Unit 4 - Nozzle 1 (PMG)', pmg_id, unit4_id, true, NOW(), NOW()),
    (gen_random_uuid(), 2, 'Unit 4 - Nozzle 2 (HSD)', hsd_id, unit4_id, true, NOW(), NOW());

  RAISE NOTICE 'Configuration complete!';
  RAISE NOTICE 'Total Units: 4, Total Nozzles: 6';
END $$;

-- Verify the setup
SELECT 'Customers:' as info, COUNT(*) as count FROM "Customer";
SELECT 'Dispensing Units:' as info, COUNT(*) as count FROM "DispensingUnit";
SELECT 'Nozzles:' as info, COUNT(*) as count FROM "Nozzle";
