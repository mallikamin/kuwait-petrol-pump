/**
 * One-shot repair: update the ItemRef on historical QB SalesReceipts / Invoices
 * that posted non-fuel sales to the wrong QB Item (id 82 "OIL FILTER 333" —
 * the 'non-fuel-item' alias).
 *
 * For each synced non-fuel sale:
 *   1. GET the QB doc (SalesReceipt or Invoice based on payment method)
 *   2. Identify the line(s) carrying the non-fuel product
 *   3. Rewrite ItemRef.value to the product's new qb_item_id
 *   4. POST the full doc back with sparse=true to apply the update
 *
 * Dry-run prints the planned changes without writing to QB.
 * Live pass writes one-by-one.
 *
 *   docker cp scripts/fix_historical_nonfuel_qb_items.js kuwaitpos-backend:/tmp/fix.js
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/fix.js ./fix.js && node fix.js --dry-run && rm fix.js'
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/fix.js ./fix.js && node fix.js --execute && rm fix.js'
 */

const https = require('https');
const { PrismaClient } = require('@prisma/client');
const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

const DRY = process.argv.includes('--dry-run');
const EXEC = process.argv.includes('--execute');
if (!DRY && !EXEC) {
  console.error('Usage: node fix_historical_nonfuel_qb_items.js [--dry-run | --execute]');
  process.exit(1);
}

const prisma = new PrismaClient();

function qb(realmId, accessToken, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'quickbooks.api.intuit.com',
        path: `/v3/company/${realmId}/${path}?minorversion=65`,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ status: res.statusCode, body: b }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Fix historical non-fuel QB line items');
  console.log('=====================================');
  console.log('Mode:', DRY ? 'DRY-RUN (no QB writes)' : 'EXECUTE');
  console.log();

  await connectRedis();
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { organizationId, realmId } = conn;
  const tok = await getValidAccessToken(organizationId);
  const accessToken = tok.accessToken;

  // Pull all synced non-fuel sales + their product's current qb_item_id.
  const sales = await prisma.$queryRaw`
    SELECT s.id::text        AS sale_id,
           s.payment_method  AS payment_method,
           s.qb_invoice_id   AS qb_doc_id,
           p.id::text        AS product_id,
           p.name            AS product_name,
           p.qb_item_id      AS product_qb_item_id,
           nfs.quantity,
           nfs.unit_price,
           nfs.total_amount
    FROM sales s
    JOIN non_fuel_sales nfs ON nfs.sale_id = s.id
    JOIN products p         ON p.id = nfs.product_id
    WHERE s.qb_synced = true
      AND s.qb_invoice_id IS NOT NULL
      AND s.sale_type = 'non_fuel'
    ORDER BY s.sale_date ASC
  `;

  console.log(`Candidates: ${sales.length}`);
  const fixed = []; const skipped = []; const failed = [];

  for (const s of sales) {
    if (!s.product_qb_item_id) {
      skipped.push({ sale: s, reason: 'product has no qb_item_id (leave alone)' });
      continue;
    }
    // Fetch the QB doc. Try both endpoints since payment method → doc type
    // mapping has drifted across sprints. QB returns 400 "TxnType does not
    // match" when we hit the wrong endpoint; use that to pick the right one.
    let typePath = 'salesreceipt';
    let typeEntity = 'SalesReceipt';
    let r = await qb(realmId, accessToken, 'GET', `${typePath}/${s.qb_doc_id}`);
    if (r.status === 400 && JSON.stringify(r.body).includes('TxnType does not match')) {
      typePath = 'invoice'; typeEntity = 'Invoice';
      r = await qb(realmId, accessToken, 'GET', `${typePath}/${s.qb_doc_id}`);
    }
    if (r.status !== 200 || !r.body[typeEntity]) {
      failed.push({ sale: s, stage: 'GET', status: r.status, body: r.body });
      continue;
    }
    const doc = r.body[typeEntity];
    // Find the SalesItemLineDetail line whose amount matches the product line
    // AND current ItemRef differs from the target. Only touch non-matching lines.
    let changed = false;
    const newLines = (doc.Line || []).map((line) => {
      if (line.DetailType !== 'SalesItemLineDetail') return line;
      const itemRef = line.SalesItemLineDetail?.ItemRef;
      if (!itemRef) return line;
      const targetId = String(s.product_qb_item_id);
      if (String(itemRef.value) === targetId) return line; // already right
      // Match this line by amount + qty + unit_price.
      const amtMatch = Number(line.Amount) === Number(s.total_amount);
      const qtyMatch = Number(line.SalesItemLineDetail.Qty || 0) === Number(s.quantity);
      if (!amtMatch || !qtyMatch) return line; // conservative: don't touch non-matching lines
      changed = true;
      return {
        ...line,
        SalesItemLineDetail: {
          ...line.SalesItemLineDetail,
          ItemRef: { value: targetId },
        },
      };
    });
    if (!changed) {
      skipped.push({ sale: s, reason: 'no matching line needed fix' });
      continue;
    }

    const oldItemId = doc.Line?.find((l) => l.DetailType === 'SalesItemLineDetail')?.SalesItemLineDetail?.ItemRef?.value;
    console.log(
      `  ${typeEntity === 'Invoice' ? 'Inv' : 'SR '} ${String(s.qb_doc_id).padEnd(5)} ${s.product_name.slice(0, 40).padEnd(40)}  item ${oldItemId} -> ${s.product_qb_item_id}`,
    );

    if (DRY) {
      fixed.push({ sale: s, dryRun: true });
      continue;
    }

    // Sparse update: only Id + SyncToken + Line needed. But QB docs say the
    // full Line array must be included for SalesReceipt. Send sparse=true +
    // full Line array.
    const updateBody = {
      Id: doc.Id,
      SyncToken: doc.SyncToken,
      sparse: true,
      Line: newLines,
    };
    const u = await qb(realmId, accessToken, 'POST', typePath, updateBody);
    if (u.status !== 200) {
      failed.push({ sale: s, stage: 'POST', status: u.status, body: u.body });
      continue;
    }
    fixed.push({ sale: s });
  }

  console.log();
  console.log('Results:');
  console.log(`  fixed:   ${fixed.length}`);
  console.log(`  skipped: ${skipped.length}`);
  console.log(`  failed:  ${failed.length}`);
  if (failed.length) {
    console.log();
    console.log('Failures:');
    for (const f of failed) {
      console.log(`  sale=${f.sale.sale_id} stage=${f.stage} status=${f.status} body=${JSON.stringify(f.body).slice(0, 200)}`);
    }
  }
  if (skipped.length && DRY) {
    console.log();
    console.log('Skip reasons:');
    const reasons = {};
    for (const s of skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    for (const [r, n] of Object.entries(reasons)) console.log(`  ${n}x ${r}`);
  }

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
}

main().catch((e) => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
