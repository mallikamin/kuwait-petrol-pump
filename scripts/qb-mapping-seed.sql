-- =============================================================================
-- QB Entity Mapping Seed — Production CoA (Kuwait Petrol Pump POS)
-- Source: QuickBooks Entities.xlsx + POS-QB Mapping.xlsx (2026-04-12 snapshot)
-- Run:  docker exec kuwaitpos-postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/qb-mapping-seed.sql
-- Safe: idempotent UPSERT on (organization_id, entity_type, local_id)
--
-- Schema notes (verified against production 2026-04-19):
--   * `organizations` has no `is_active` column. Single-tenant deployment
--     assumed; we pick the single row. Extend with WHERE name = '...' if
--     multi-tenant is ever introduced.
--   * `qb_entity_mappings` carries TWO unique indexes:
--       uq_qb_mapping_org_type_local  (org_id, entity_type, local_id)  ← upsert target
--       uq_qb_mapping_org_type_qb     (org_id, entity_type, qb_id)     ← reverse lookup
--     The second prevents two local_ids from sharing a qb_id for the same
--     entity_type. This is why we seed ONE canonical payment_method row per
--     QB PaymentMethod id (cards collapse to 'credit_card' in code — see
--     `paymentMethodLocalId` in qb-shared.ts).
-- =============================================================================

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Resolve the single organization.
  SELECT id INTO v_org_id FROM organizations ORDER BY created_at LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found. Seed aborted.';
  END IF;

  RAISE NOTICE 'Seeding QB entity mappings for organization: %', v_org_id;

  -- ── CUSTOMERS (receivables + gain/loss) ───────────────────────────────────
  -- S1–S3: Walk-in customer for cash SalesReceipt
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'customer', 'walk-in', 'Walk-in Customer', '71', 'walk in customer', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- S6 (bank-card path) + S4 card-route: Bank Card Receivable
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'customer', 'bank-card-receivable', 'Bank Card Receivable', '17', 'Bank Card Receiveable', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- S7: PSO fleet card receivable
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'customer', 'pso-card-receivable', 'PSO Card Receivable', '55', 'PSO Card Receivables', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- S11: HSD gain/loss JE customer (reserved)
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'customer', 'hsd-gain-loss', 'HSD Gain/Loss', '34', 'HSD gain/loss', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- S11: PMG gain/loss JE customer (reserved)
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'customer', 'pmg-gain-loss', 'PMG Gain/Loss', '53', 'PMG gain/loss', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- ── ACCOUNTS (S11 Journal Entry legs) ─────────────────────────────────────
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'account', 'inventory-asset', 'Inventory Asset', '97', 'Inventory Asset', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'account', 'hsd-gain-income', 'HSD Normal Volume Gain', '155', 'HSD normal volume gain', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'account', 'pmg-gain-income', 'PMG Normal Volume Gain', '161', 'PMG normal volume gain', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    -- 2026-04-27: kpc accountant moved loss accounts out of (deleted) Cost
    -- of Goods Sold tree into Other Expense. New IDs reflect that reorg.
    -- For other tenants, prefer `qb-seed-discover --org <code> --apply`
    -- which auto-discovers the correct IDs against their realm.
    (gen_random_uuid(), v_org_id, 'account', 'hsd-loss-expense', 'HSD Normal Volume Loss', '1150040007', 'HSD Normal Volume Loss', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'account', 'pmg-loss-expense', 'PMG Normal Volume Loss', '1150040008', 'PMG Normal Volume Loss', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- ── BANK ACCOUNTS (deposit routing) ───────────────────────────────────────
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'bank_account', 'cash', 'Cash in Hand', '90', 'Cash in Hand', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'bank_account', 'default_checking', 'ABL Bank (default)', '88', 'ABL Bank', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  -- ── PAYMENT METHODS ────────────────────────────────────────────────────────
  -- Three rows only — one per QB PaymentMethod id. POS-side card sub-types
  -- (bank_card, pso_card) collapse to 'credit_card' at lookup time via
  -- `paymentMethodLocalId` in qb-shared.ts; the AR customer sub-ledger is what
  -- distinguishes them downstream, not the PaymentMethodRef.
  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'payment_method', 'cash', 'Cash', '2', 'Cash', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'payment_method', 'credit_card', 'Credit Card (all card types)', '4', 'Credit Card', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  INSERT INTO qb_entity_mappings
    (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, 'payment_method', 'credit_customer', 'Credit Customer (AR)', '3', 'Cheque', true, now())
  ON CONFLICT (organization_id, entity_type, local_id)
  DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, updated_at = now();

  RAISE NOTICE 'Static seed complete for org %', v_org_id;
END $$;

-- ── DYNAMIC: FUEL TYPE UUID → QB Item ID ──────────────────────────────────
-- The POS handler always passes FuelType UUID as the item localId (verified in
-- sales.service.ts:304 and daily.service.ts:1768). Seed one item mapping per
-- fuel type row found in the local fuel_types table.
DO $$
DECLARE
  v_org_id UUID;
  ft RECORD;
  v_qb_id TEXT;
  v_qb_name TEXT;
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY created_at LIMIT 1;

  FOR ft IN SELECT id, name, code FROM fuel_types LOOP
    -- Resolve QB id by fuel code (reliable: 'HSD' or 'PMG'); fall back to name.
    IF UPPER(COALESCE(ft.code, ft.name)) LIKE '%HSD%' OR UPPER(ft.name) LIKE '%DIESEL%' THEN
      v_qb_id := '105'; v_qb_name := 'HSD';
    ELSIF UPPER(COALESCE(ft.code, ft.name)) LIKE '%PMG%' OR UPPER(ft.name) LIKE '%PETROL%' OR UPPER(ft.name) LIKE '%GASOLINE%' THEN
      v_qb_id := '106'; v_qb_name := 'PMG';
    ELSE
      RAISE WARNING 'Fuel type % (code=%, id=%) has no known QB item mapping — skipped', ft.name, ft.code, ft.id;
      CONTINUE;
    END IF;

    INSERT INTO qb_entity_mappings
      (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
    VALUES
      (gen_random_uuid(), v_org_id, 'item', ft.id::text, ft.name, v_qb_id, v_qb_name, true, now())
    ON CONFLICT (organization_id, entity_type, local_id)
    DO UPDATE SET qb_id = EXCLUDED.qb_id, qb_name = EXCLUDED.qb_name, local_name = EXCLUDED.local_name, updated_at = now();

    RAISE NOTICE 'Fuel item mapping: % (%) → QB %', ft.name, ft.id, v_qb_id;
  END LOOP;

  RAISE NOTICE 'Fuel item seed complete.';
END $$;

-- ── Verification query ────────────────────────────────────────────────────────
SELECT entity_type, local_id, local_name, qb_id, qb_name, is_active
FROM qb_entity_mappings
WHERE is_active = true
ORDER BY entity_type, local_id;

-- ── Manual additions — run these separately with actual IDs ──────────────────
-- A) One credit customer mapping per AR customer to be synced. For S4/S5/S8:
--
--    SELECT id, name FROM customers WHERE is_credit = true;
--
--    -- Then for each row:
--    INSERT INTO qb_entity_mappings (id, organization_id, entity_type, local_id, local_name, qb_id, qb_name, is_active, updated_at)
--    VALUES (gen_random_uuid(), '<org_id>', 'customer', '<customer_uuid>', '<name>', '<QB_customer_id>', '<QB_name>', true, now())
--    ON CONFLICT (organization_id, entity_type, local_id) DO UPDATE SET qb_id = EXCLUDED.qb_id, updated_at = now();
--
-- B) Non-fuel item SKUs — only if non-fuel SalesReceipt/Invoice syncing is enabled.
--
--    SELECT id, name FROM products;
--
-- C) PSO vendor (deferred — S9/S10 Bills). Blocked on QB vendor id.
--
--    Step 1: GET /v3/company/<realmId>/query?query=SELECT * FROM Vendor WHERE DisplayName LIKE '%PSO%'
--    Step 2: SELECT id FROM suppliers WHERE name ILIKE '%pso%';
--    Step 3: INSERT with entityType='vendor'.
--
-- D) Additional banks (BOP, Faysal, MCB etc.) for ReceivePayment deposit routing.
--
--    SELECT id, name FROM banks;
--    -- For each: INSERT with entityType='bank_account', local_id=<bank uuid>, qb_id=<QB Account id>
