/**
 * Cash Ledger Backfill
 *
 * The cash ledger migration (20260422_add_cash_ledger) shipped on
 * 2026-04-22. Every sale / advance movement / pso topup / expense
 * created before that date never posted a row into cash_ledger_entries
 * — so the Cash Reconciliation page shows 0 for all historical days
 * even when the underlying sales exist.
 *
 * This script replays those historical events into the ledger. It is
 * idempotent: the unique_cash_ledger_source_direction constraint
 * (source, source_id, direction) turns every re-run into a no-op.
 *
 *   docker cp scripts/backfill_cash_ledger.js kuwaitpos-backend:/tmp/bf.js
 *   docker exec kuwaitpos-backend node /tmp/bf.js --dry-run
 *   docker exec kuwaitpos-backend node /tmp/bf.js --execute
 *
 * Scope (what moves into the ledger):
 *   - sales WHERE payment_method = 'cash'                → IN, SALE
 *   - customer_advance_movements kind='DEPOSIT_CASH'     → IN, ADVANCE_DEPOSIT
 *   - customer_advance_movements kind='CASH_HANDOUT'     → OUT, DRIVER_HANDOUT
 *   - pso_topups                                         → IN, PSO_TOPUP
 *   - expense_entries                                    → OUT, EXPENSE
 *
 * Voided rows (voided_at IS NOT NULL) are skipped — their cash never
 * left the drawer. For sales the concept is sync_status='cancelled'
 * (sales lacks voided_at); we skip payment_method != 'cash' and the
 * idempotency key handles re-runs.
 *
 * QB sync is untouched. This writes ledger rows only. The underlying
 * sales / expenses / topups / advance movements keep whatever
 * qb_synced state they already have.
 */

const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry-run');
const EXEC = process.argv.includes('--execute');

if (!DRY && !EXEC) {
  console.error('Usage: node backfill_cash_ledger.js [--dry-run | --execute]');
  process.exit(1);
}

const prisma = new PrismaClient();

async function countPlan() {
  const [salesCash, depositCash, handouts, topups, expenses] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount), 0)::text AS total
      FROM sales s
      WHERE s.payment_method = 'cash'
        AND NOT EXISTS (
          SELECT 1 FROM cash_ledger_entries cle
          WHERE cle.source = 'SALE'
            AND cle.source_id = s.id
            AND cle.direction = 'IN'
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
      FROM customer_advance_movements m
      WHERE m.kind = 'DEPOSIT_CASH'
        AND m.direction = 'IN'
        AND m.voided_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cash_ledger_entries cle
          WHERE cle.source = 'ADVANCE_DEPOSIT'
            AND cle.source_id = m.id
            AND cle.direction = 'IN'
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
      FROM customer_advance_movements m
      WHERE m.kind = 'CASH_HANDOUT'
        AND m.direction = 'OUT'
        AND m.voided_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cash_ledger_entries cle
          WHERE cle.source = 'DRIVER_HANDOUT'
            AND cle.source_id = m.id
            AND cle.direction = 'OUT'
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
      FROM pso_topups t
      WHERE t.voided_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cash_ledger_entries cle
          WHERE cle.source = 'PSO_TOPUP'
            AND cle.source_id = t.id
            AND cle.direction = 'IN'
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
      FROM expense_entries e
      WHERE e.voided_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cash_ledger_entries cle
          WHERE cle.source = 'EXPENSE'
            AND cle.source_id = e.id
            AND cle.direction = 'OUT'
        )
    `,
  ]);
  return {
    salesCash: salesCash[0],
    depositCash: depositCash[0],
    handouts: handouts[0],
    topups: topups[0],
    expenses: expenses[0],
  };
}

async function execute() {
  // Each INSERT copies source → cash_ledger_entries. The SELECT joins
  // sales → branches to pick up organization_id (sales lacks it).
  // ON CONFLICT DO NOTHING relies on unique_cash_ledger_source_direction.
  const results = {};

  // 1. Cash sales → IN, SALE
  const r1 = await prisma.$executeRaw`
    INSERT INTO cash_ledger_entries (
      id, organization_id, branch_id, business_date, shift_instance_id,
      direction, source, source_id, amount, memo, created_at
    )
    SELECT
      gen_random_uuid(),
      b.organization_id,
      s.branch_id,
      s.sale_date::date,
      s.shift_instance_id,
      'IN',
      'SALE',
      s.id,
      s.total_amount,
      CONCAT('Backfill: sale ', COALESCE(s.slip_number, s.id::text)),
      s.sale_date
    FROM sales s
    JOIN branches b ON b.id = s.branch_id
    WHERE s.payment_method = 'cash'
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_entries cle
        WHERE cle.source = 'SALE' AND cle.source_id = s.id AND cle.direction = 'IN'
      )
    ON CONFLICT (source, source_id, direction) DO NOTHING
  `;
  results.sales = r1;

  // 2. Advance cash deposits → IN, ADVANCE_DEPOSIT
  const r2 = await prisma.$executeRaw`
    INSERT INTO cash_ledger_entries (
      id, organization_id, branch_id, business_date, shift_instance_id,
      direction, source, source_id, amount, memo, created_by, created_at
    )
    SELECT
      gen_random_uuid(),
      m.organization_id,
      m.branch_id,
      m.business_date,
      m.shift_instance_id,
      'IN',
      'ADVANCE_DEPOSIT',
      m.id,
      m.amount,
      CONCAT('Backfill: advance deposit — ', COALESCE(m.memo, m.id::text)),
      m.created_by,
      m.created_at
    FROM customer_advance_movements m
    WHERE m.kind = 'DEPOSIT_CASH'
      AND m.direction = 'IN'
      AND m.voided_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_entries cle
        WHERE cle.source = 'ADVANCE_DEPOSIT' AND cle.source_id = m.id AND cle.direction = 'IN'
      )
    ON CONFLICT (source, source_id, direction) DO NOTHING
  `;
  results.depositCash = r2;

  // 3. Driver cash handouts → OUT, DRIVER_HANDOUT
  const r3 = await prisma.$executeRaw`
    INSERT INTO cash_ledger_entries (
      id, organization_id, branch_id, business_date, shift_instance_id,
      direction, source, source_id, amount, memo, created_by, created_at
    )
    SELECT
      gen_random_uuid(),
      m.organization_id,
      m.branch_id,
      m.business_date,
      m.shift_instance_id,
      'OUT',
      'DRIVER_HANDOUT',
      m.id,
      m.amount,
      CONCAT('Backfill: driver handout — ', COALESCE(m.memo, m.id::text)),
      m.created_by,
      m.created_at
    FROM customer_advance_movements m
    WHERE m.kind = 'CASH_HANDOUT'
      AND m.direction = 'OUT'
      AND m.voided_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_entries cle
        WHERE cle.source = 'DRIVER_HANDOUT' AND cle.source_id = m.id AND cle.direction = 'OUT'
      )
    ON CONFLICT (source, source_id, direction) DO NOTHING
  `;
  results.handouts = r3;

  // 4. PSO top-ups → IN, PSO_TOPUP
  const r4 = await prisma.$executeRaw`
    INSERT INTO cash_ledger_entries (
      id, organization_id, branch_id, business_date, shift_instance_id,
      direction, source, source_id, amount, memo, created_by, created_at
    )
    SELECT
      gen_random_uuid(),
      t.organization_id,
      t.branch_id,
      t.business_date,
      t.shift_instance_id,
      'IN',
      'PSO_TOPUP',
      t.id,
      t.amount,
      CONCAT('Backfill: PSO top-up — card **** ', COALESCE(t.pso_card_last4, '????')),
      t.created_by,
      t.created_at
    FROM pso_topups t
    WHERE t.voided_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_entries cle
        WHERE cle.source = 'PSO_TOPUP' AND cle.source_id = t.id AND cle.direction = 'IN'
      )
    ON CONFLICT (source, source_id, direction) DO NOTHING
  `;
  results.topups = r4;

  // 5. Expense entries → OUT, EXPENSE
  const r5 = await prisma.$executeRaw`
    INSERT INTO cash_ledger_entries (
      id, organization_id, branch_id, business_date, shift_instance_id,
      direction, source, source_id, amount, memo, created_by, created_at
    )
    SELECT
      gen_random_uuid(),
      e.organization_id,
      e.branch_id,
      e.business_date,
      e.shift_instance_id,
      'OUT',
      'EXPENSE',
      e.id,
      e.amount,
      CONCAT('Backfill: expense — ', COALESCE(e.memo, e.id::text)),
      e.created_by,
      e.created_at
    FROM expense_entries e
    WHERE e.voided_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_entries cle
        WHERE cle.source = 'EXPENSE' AND cle.source_id = e.id AND cle.direction = 'OUT'
      )
    ON CONFLICT (source, source_id, direction) DO NOTHING
  `;
  results.expenses = r5;

  return results;
}

async function main() {
  console.log('Cash Ledger Backfill');
  console.log('====================');
  console.log('Mode:', DRY ? 'DRY-RUN (no writes)' : 'EXECUTE');
  console.log();

  console.log('Planning (counts of rows that will be inserted)...');
  const plan = await countPlan();
  const rows = [
    { label: 'Cash Sales           → IN  SALE',             ...plan.salesCash },
    { label: 'Advance Deposits     → IN  ADVANCE_DEPOSIT',  ...plan.depositCash },
    { label: 'Driver Handouts      → OUT DRIVER_HANDOUT',   ...plan.handouts },
    { label: 'PSO Top-ups          → IN  PSO_TOPUP',        ...plan.topups },
    { label: 'Expenses             → OUT EXPENSE',          ...plan.expenses },
  ];
  let grandRows = 0, grandSum = 0;
  console.log();
  console.log('  ' + 'Source'.padEnd(42) + ' '.padStart(8) + 'Rows'.padStart(8) + '  Amount');
  console.log('  ' + '-'.repeat(72));
  for (const r of rows) {
    grandRows += r.n;
    grandSum += parseFloat(r.total);
    console.log('  ' + r.label.padEnd(42) + String(r.n).padStart(8) + '  Rs ' + parseFloat(r.total).toLocaleString('en-PK'));
  }
  console.log('  ' + '-'.repeat(72));
  console.log('  ' + 'TOTAL'.padEnd(42) + String(grandRows).padStart(8) + '  Rs ' + grandSum.toLocaleString('en-PK'));
  console.log();

  if (DRY) {
    console.log('DRY-RUN complete. Re-run with --execute to insert.');
    return;
  }

  if (grandRows === 0) {
    console.log('Nothing to backfill. Ledger is already in sync.');
    return;
  }

  console.log('Executing...');
  const t0 = Date.now();
  const res = await execute();
  const dt = Date.now() - t0;
  console.log();
  console.log('  Inserted counts:');
  console.log('    sales       ', res.sales);
  console.log('    depositCash ', res.depositCash);
  console.log('    handouts    ', res.handouts);
  console.log('    topups      ', res.topups);
  console.log('    expenses    ', res.expenses);
  console.log();
  console.log('Done in', dt, 'ms.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
