/**
 * Backfill Script: monthly_inventory_gain_loss snapshot columns
 *
 * Some legacy gain/loss rows were created before migration
 * 20260425_gain_loss_business_date introduced the snapshot columns
 * (book_qty_at_date, last_purchase_rate, value_at_rate). They render
 * "—" everywhere on the Gain/Loss page except the quantity column.
 *
 * This script populates those snapshots for any row missing one of
 * them. The basis used is the row's own businessDate (NOT today's
 * rate) so the captured rate is the period rate. Quantity is
 * preserved exactly — only the snapshot columns are written.
 *
 * Idempotent: filters on `IS NULL` so subsequent runs are no-ops.
 * Dry-run by default; pass `--apply` to write.
 *
 * Usage (from container after build):
 *   node /app/apps/backend/dist/scripts/backfill-gain-loss-snapshots.js
 *   node /app/apps/backend/dist/scripts/backfill-gain-loss-snapshots.js --apply
 *
 * Usage (local dev with ts-node/tsx):
 *   tsx apps/backend/src/scripts/backfill-gain-loss-snapshots.ts
 *   tsx apps/backend/src/scripts/backfill-gain-loss-snapshots.ts --apply
 */

import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { computeStockAtDate } from '../modules/inventory/stock-at-date.service';

interface RowResult {
  id: string;
  branchId: string;
  fuelCode: string;
  businessDate: string;
  quantity: number;
  before: {
    bookQtyAtDate: number | null;
    lastPurchaseRate: number | null;
    valueAtRate: number | null;
  };
  after: {
    bookQtyAtDate: number;
    lastPurchaseRate: number;
    valueAtRate: number;
  } | null;
  skipReason?: string;
}

const fmt = (n: number | null | undefined, dp = 3) =>
  n == null ? '—' : Number(n).toFixed(dp);

async function backfill(apply: boolean) {
  console.log('🔍 Gain/Loss snapshot backfill');
  console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN (no writes)'}\n`);

  const rows = await prisma.monthlyInventoryGainLoss.findMany({
    where: {
      OR: [
        { lastPurchaseRate: null },
        { valueAtRate: null },
        { bookQtyAtDate: null },
      ],
    },
    include: {
      branch: { select: { id: true, name: true, organizationId: true } },
      fuelType: { select: { code: true } },
    },
    orderBy: [{ businessDate: 'asc' }, { fuelTypeId: 'asc' }],
  });

  if (rows.length === 0) {
    console.log('✅ Nothing to backfill — all rows already have snapshots.');
    return { total: 0, updated: 0, skipped: 0, results: [] as RowResult[] };
  }

  console.log(`Found ${rows.length} row(s) needing backfill.\n`);

  const results: RowResult[] = [];
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const businessDateStr = row.businessDate.toISOString().slice(0, 10);
    const qty = Number(row.quantity);

    const before = {
      bookQtyAtDate:
        row.bookQtyAtDate != null ? Number(row.bookQtyAtDate.toString()) : null,
      lastPurchaseRate:
        row.lastPurchaseRate != null ? Number(row.lastPurchaseRate.toString()) : null,
      valueAtRate:
        row.valueAtRate != null ? Number(row.valueAtRate.toString()) : null,
    };

    let stock;
    try {
      stock = await computeStockAtDate({
        branchId: row.branchId,
        fuelTypeId: row.fuelTypeId,
        asOfDate: businessDateStr,
      });
    } catch (err: any) {
      const skipReason = `computeStockAtDate failed: ${err?.message || err}`;
      results.push({
        id: row.id,
        branchId: row.branchId,
        fuelCode: row.fuelType.code,
        businessDate: businessDateStr,
        quantity: qty,
        before,
        after: null,
        skipReason,
      });
      skipped++;
      continue;
    }

    if (stock.lastPurchaseRate == null) {
      const skipReason =
        'no purchase rate found on/before businessDate (no prior purchase history)';
      results.push({
        id: row.id,
        branchId: row.branchId,
        fuelCode: row.fuelType.code,
        businessDate: businessDateStr,
        quantity: qty,
        before,
        after: null,
        skipReason,
      });
      skipped++;
      continue;
    }

    const newBookQty = Number(stock.bookQty.toFixed(3));
    const newRate = Number(stock.lastPurchaseRate.toFixed(4));
    const newValue = Number((qty * newRate).toFixed(2));

    const after = {
      bookQtyAtDate: newBookQty,
      lastPurchaseRate: newRate,
      valueAtRate: newValue,
    };

    results.push({
      id: row.id,
      branchId: row.branchId,
      fuelCode: row.fuelType.code,
      businessDate: businessDateStr,
      quantity: qty,
      before,
      after,
    });

    if (apply) {
      // Only write the columns that are currently null — don't overwrite
      // any value an operator might have manually populated since.
      const data: Record<string, Decimal> = {};
      if (before.bookQtyAtDate == null) data.bookQtyAtDate = new Decimal(newBookQty);
      if (before.lastPurchaseRate == null) data.lastPurchaseRate = new Decimal(newRate);
      if (before.valueAtRate == null) data.valueAtRate = new Decimal(newValue);

      if (Object.keys(data).length > 0) {
        await prisma.monthlyInventoryGainLoss.update({
          where: { id: row.id },
          data,
        });
      }
      updated++;
    }
  }

  // Audit table
  console.log('📋 Per-row plan:');
  console.log(
    '─────────────────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    console.log(
      `${r.businessDate} ${r.fuelCode.padEnd(3)} qty=${fmt(r.quantity, 3).padStart(10)} ` +
        `branch=${r.branchId.slice(0, 8)} id=${r.id.slice(0, 8)}`,
    );
    console.log(
      `  before: bookQty=${fmt(r.before.bookQtyAtDate)} ` +
        `rate=${fmt(r.before.lastPurchaseRate, 4)} ` +
        `value=${fmt(r.before.valueAtRate, 2)}`,
    );
    if (r.after) {
      console.log(
        `  after : bookQty=${fmt(r.after.bookQtyAtDate)} ` +
          `rate=${fmt(r.after.lastPurchaseRate, 4)} ` +
          `value=${fmt(r.after.valueAtRate, 2)}`,
      );
    } else {
      console.log(`  SKIP  : ${r.skipReason}`);
    }
  }
  console.log(
    '─────────────────────────────────────────────────────────────────────────────',
  );

  console.log(`\nSummary: ${rows.length} candidate(s), ${updated} updated, ${skipped} skipped.`);

  if (!apply) {
    console.log('\n⚠️  DRY RUN — no rows written. Re-run with --apply to commit.');
  } else {
    console.log('\n✅ Apply complete.');
  }

  return { total: rows.length, updated, skipped, results };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  backfill(apply)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Backfill failed:', err);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { backfill };
