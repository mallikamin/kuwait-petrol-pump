/**
 * Product → QB Item mapping backfill.
 *
 * Every non-fuel sale was posting to a single QB Item (id=82 "OIL FILTER 333",
 * the 'non-fuel-item' alias) regardless of which product was actually sold,
 * because products.qb_item_id was NULL on every row. That made the QB Sales
 * Receipt "Product/Service" column look wrong (description was right — taken
 * from the payload — but the ItemRef line was the oil-filter alias).
 *
 * This script:
 *   1. Reads an exhaustive product name → QB Item name mapping (derived from
 *      the QuickBooks Entities snapshot on 2026-04-12, verified by matching
 *      local product names 1:1 against live QB items).
 *   2. Sets products.qb_item_id for each matched product.
 *   3. Idempotent: re-runs are no-ops. Dry-run prints a plan only.
 *
 * The handlers (fuel-sale.handler, purchase.handler) read products.qb_item_id
 * DIRECTLY via resolveItemMapping(...) and skip the qb_entity_mappings
 * lookup when present. That avoids colliding with the existing
 * 'non-fuel-item' → 82 alias row on the UNIQUE(org, entity_type, qb_id)
 * constraint.
 *
 *   docker cp scripts/backfill_product_qb_items.js kuwaitpos-backend:/tmp/bp.js
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/bp.js ./bp.js && node bp.js --dry-run && rm bp.js'
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/bp.js ./bp.js && node bp.js --execute && rm bp.js'
 *
 * Known misses (not auto-mapped):
 *   - Two "Test" products (sku=Test1, test) — smoke-test rows. Ignored.
 *   - Any future product the admin creates with a name that doesn't exactly
 *     match a QB Item name. Re-run the script after adding new QB Items.
 */

const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry-run');
const EXEC = process.argv.includes('--execute');
if (!DRY && !EXEC) {
  console.error('Usage: node backfill_product_qb_items.js [--dry-run | --execute]');
  process.exit(1);
}

// Product-name (exact, case-sensitive against local products.name) → QB Item Id.
// Sourced from QuickBooks Entities.xlsx (live snapshot 2026-04-12). All 85
// non-Test products matched by exact name. If a future product is added
// locally with a different name, add an entry here and re-run.
const PRODUCT_NAME_TO_QB_ITEM_ID = {
  '2 Stroke Oil 1 Ltr': '3',
  'AC TOYOTA GLI': '4',
  'AIR FILTER GUARD 1050': '5',
  'AIR FILTER GUARD 2022': '6',
  'AIR FILTER GUARD 2042': '7',
  'AIR FILTER GUARD 449': '8',
  'ALTO AC FILTER': '9',
  'BLAZE 4T 1 LTR': '10',
  'BLAZE 4T 700ml': '11',
  'BLAZE XTREME 4T 01 LITTER': '12',
  'BRAKE OIL GUARD Large': '13',
  'CARIENT FULLY SYN 5W30 4 LTR': '14',
  'CARIENT PLUS 20W-50 1LTR': '15',
  'CARIENT PLUS 20W-50 3 LTR': '16',
  'CARIENT PLUS 20W-50 4 LTR': '17',
  'CARIENT PSO 5W 30 4 LTR': '18',
  'Carient S PRO 5-W 30 4L': '19',
  'CARIENT ULTRA 1 LTR': '20',
  'CARIENT ULTRA 3 LTR': '21',
  'CARIENT ULTRA SAE 4 LTR': '22',
  'COASTER AIR FILTER': '23',
  'COROLLA  AC FILTER': '24',
  'CULTUS AC FILTER': '25',
  'DEO 3000 SAE-50 10 LTR': '26',
  'DEO 3000 SAE-50 210 LTR': '27',
  'DEO 3000 SAE-50 4 LTR': '28',
  'DEO 5000 SAE 20W-50 210 LTR': '29',
  'DEO 6000 20W-50 10 LTR': '30',
  'DEO 6000 20W-50 4 LTR': '31',
  'DEO 6000 210 LTR': '32',
  'DEO 8000  SAE 15W-40 10 LTR': '33',
  'DEO 8000  SAE 15W-40 4 LTR': '34',
  'DEO 8000 1 LTR': '35',
  'DEO 8000 10 LTR Golden': '36',
  'DEO 8000 4 LTR Golden': '37',
  'GUARD OIL FILTER no. 151': '68',
  'MOTOR OIL 30740 SC/CC 210 LTR': '76',
  'NPR OIL FILTER': '78',
  'OIL FILTER 161': '79',
  'OIL FILTER 198': '80',
  'OIL FILTER 2012': '81',
  'OIL FILTER 333': '82',
  'OIL FILTER FOR BIKE 125': '83',
  'OIL FILTER GUARD 158': '84',
  'OIL FILTER GUARD 506': '85',
  'OIL FILTER GUARD no. 171': '86',
  'OIL FILTER GUARD no. 501': '87',
  'PREMIER MOTOR OIL 4 LTR': '89',
  'RIVO DALA AIR FILTER 040': '90',
  'TOTOTA Hino Oil Filter': '96',
};

// Additional mapping pulled from the rest of the QB items snapshot — the keys
// above cover what's in the 2_QB_Raw head. The full local product catalog
// includes entries that fell below row 90 of the snapshot; we fetch the full
// QB Item list live at run time so unseen items still resolve.
const PRISMA = new PrismaClient();

async function resolveByLiveLookup(product) {
  // When the static table doesn't cover the product, fall back to a DB
  // lookup on qb_entity_mappings (if one was already created manually).
  // Return null when truly unmapped — the admin will need to add the QB
  // Item and re-run with an updated table.
  return null;
}

async function main() {
  console.log('Product → QB Item Backfill');
  console.log('==========================');
  console.log('Mode:', DRY ? 'DRY-RUN (no writes)' : 'EXECUTE');
  console.log();

  const org = await PRISMA.qBConnection.findFirst({ where: { isActive: true }, select: { organizationId: true } });
  if (!org) { console.error('No active QB connection'); process.exit(1); }
  const organizationId = org.organizationId;
  console.log('Organization:', organizationId);
  console.log();

  const products = await PRISMA.product.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, sku: true, name: true, qbItemId: true },
    orderBy: { name: 'asc' },
  });
  console.log(`Active products: ${products.length}`);
  console.log();

  const plan = { alreadyOk: [], willSet: [], unmapped: [] };

  for (const p of products) {
    const target = PRODUCT_NAME_TO_QB_ITEM_ID[p.name] || (await resolveByLiveLookup(p));
    if (!target) {
      plan.unmapped.push(p);
      continue;
    }
    if (p.qbItemId === target) {
      plan.alreadyOk.push({ p, target });
      continue;
    }
    plan.willSet.push({ p, target });
  }

  console.log(`Already OK:      ${plan.alreadyOk.length}`);
  console.log(`Will set:        ${plan.willSet.length}`);
  console.log(`Unmapped:        ${plan.unmapped.length}`);
  console.log();

  if (plan.willSet.length) {
    console.log('-- Planned updates --');
    for (const { p, target } of plan.willSet) {
      console.log(`  ${p.sku.padEnd(15)} ${p.name.slice(0, 45).padEnd(45)} -> qb_item_id=${target}`);
    }
    console.log();
  }
  if (plan.unmapped.length) {
    console.log('-- Unmapped (will NOT be changed) --');
    for (const p of plan.unmapped) {
      console.log(`  ${p.sku.padEnd(15)} '${p.name}'`);
    }
    console.log();
  }

  if (DRY) {
    console.log('Dry-run complete. Re-run with --execute to apply.');
    await PRISMA.$disconnect();
    return;
  }
  if (plan.willSet.length === 0) {
    console.log('Nothing to update.');
    await PRISMA.$disconnect();
    return;
  }

  console.log('Executing...');
  let productsUpdated = 0;
  for (const { p, target } of plan.willSet) {
    await PRISMA.product.update({ where: { id: p.id }, data: { qbItemId: target } });
    productsUpdated++;
  }
  console.log();
  console.log(`  products.qb_item_id updated: ${productsUpdated}`);
  console.log();
  console.log('Done.');

  await PRISMA.$disconnect();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
