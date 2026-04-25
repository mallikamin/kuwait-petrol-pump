/**
 * Phase D final cleanup.
 *
 * Voids/deletes:
 *   1. QB Invoice 285 — yesterday's S8C placeholder
 *   2. Any QB Bill tied to a lingering SIT PO (qb_bill set on the PO row)
 *   3. Lingering PO rows with SIT-/A5B-/SIT-A5 names (and their items + receipts + stock restore)
 *   4. Lingering supplier_payment rows with SIT-/A5B- reference_number (and their queue rows)
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';
const MOTOR_OIL_PRODUCT_ID = 'c709ec4a-0a09-4f10-8913-cdbc4fa63e72';

const KNOWN_ORPHAN_QB_INVOICES = ['285']; // yesterday's S8C placeholder

function qbRequest(method, realm, pathSuffix, accessToken, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${realm}/${pathSuffix}`,
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

  await connectRedis();
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);

  console.log('═'.repeat(72));
  console.log('  Phase D final cleanup');
  console.log('═'.repeat(72));

  // ─ 1. Void/delete known orphan QB Invoices (Invoice 285) ─
  console.log('\n[1] Voiding known orphan QB Invoices...');
  for (const id of KNOWN_ORPHAN_QB_INVOICES) {
    const r = await qbRequest('GET', conn.realmId, `invoice/${id}?minorversion=65`, accessToken);
    if (r.body?.Invoice) {
      const v = await qbRequest('POST', conn.realmId, `invoice?operation=void&minorversion=65`, accessToken,
        { Id: r.body.Invoice.Id, SyncToken: r.body.Invoice.SyncToken });
      console.log(`  Invoice ${id}: ${v.status === 200 ? '✓ voided' : `✗ ${v.status}`}`);
    } else {
      console.log(`  Invoice ${id}: not found (already gone)`);
    }
  }

  // ─ 2. Void QB Bills on lingering SIT POs ─
  console.log('\n[2] Voiding QB Bills on lingering SIT POs, then cleaning DB...');
  const orphanPos = await prisma.purchaseOrder.findMany({
    where: {
      organizationId: ORG_ID,
      OR: [
        { poNumber: { startsWith: 'SIT-' } },
        { poNumber: { startsWith: 'A5B2-' } },
      ],
    },
  });

  for (const po of orphanPos) {
    console.log(`  PO ${po.id} (${po.poNumber}) qb_bill=${po.qbBillId || '-'}`);

    if (po.qbBillId) {
      const r = await qbRequest('GET', conn.realmId, `bill/${po.qbBillId}?minorversion=65`, accessToken);
      if (r.body?.Bill && r.body.Bill.Balance !== undefined && r.body.Bill.Balance !== 'VOIDED') {
        // Not already voided
        const v = await qbRequest('POST', conn.realmId, `bill?operation=void&minorversion=65`, accessToken,
          { Id: r.body.Bill.Id, SyncToken: r.body.Bill.SyncToken });
        console.log(`    void Bill ${po.qbBillId}: ${v.status === 200 ? '✓' : `✗ ${v.status}`}`);
      } else {
        console.log(`    Bill ${po.qbBillId}: not found or already voided`);
      }
    }

    // Receipts
    const receipts = await prisma.stockReceipt.findMany({ where: { purchaseOrderId: po.id } });
    for (const rc of receipts) {
      await prisma.stockReceiptItem.deleteMany({ where: { stockReceiptId: rc.id } });
      await prisma.stockReceipt.delete({ where: { id: rc.id } });
      console.log(`    deleted stockReceipt ${rc.id}`);
    }

    // Fuel inventory transactions
    const fxns = await prisma.fuelInventoryTransaction.deleteMany({
      where: { referenceType: 'purchase_order', referenceId: po.id },
    });
    if (fxns.count > 0) console.log(`    deleted ${fxns.count} fuel_inventory_transactions`);

    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
    await prisma.qBSyncQueue.deleteMany({ where: { entityId: po.id } });
    await prisma.purchaseOrder.delete({ where: { id: po.id } });
    console.log(`    deleted PO ${po.id}`);
  }

  // ─ 3. Delete lingering supplier_payments + their queue rows ─
  console.log('\n[3] Deleting lingering SIT supplier_payments...');
  const orphanPays = await prisma.supplierPayment.findMany({
    where: {
      OR: [
        { referenceNumber: { startsWith: 'SIT-' } },
        { referenceNumber: { startsWith: 'A5B-' } },
      ],
    },
  });

  for (const sp of orphanPays) {
    console.log(`  supplier_payment ${sp.id} ref=${sp.referenceNumber}`);
    await prisma.qBSyncQueue.deleteMany({ where: { entityId: sp.id } });
    await prisma.supplierPayment.delete({ where: { id: sp.id } });
    console.log(`    deleted`);
  }

  // ─ 4. Sanity check: any remaining lingering ─
  console.log('\n[4] Sanity check — any remaining lingering test data...');
  const remainingPos = await prisma.purchaseOrder.count({
    where: { organizationId: ORG_ID, OR: [{ poNumber: { startsWith: 'SIT-' } }, { poNumber: { startsWith: 'A5B2-' } }] },
  });
  const remainingPays = await prisma.supplierPayment.count({
    where: { OR: [{ referenceNumber: { startsWith: 'SIT-' } }, { referenceNumber: { startsWith: 'A5B-' } }] },
  });
  const remainingTestSales = await prisma.sale.count({
    where: {
      organizationId: ORG_ID,
      offlineQueueId: { startsWith: 'backdated-test-' },
    },
  });
  console.log(`  Test POs remaining: ${remainingPos}`);
  console.log(`  Test supplier_payments remaining: ${remainingPays}`);
  console.log(`  Test backdated-test sales remaining: ${remainingTestSales}`);

  console.log('\n' + '═'.repeat(72));
  console.log('  Phase D CLEANUP COMPLETE');
  console.log('═'.repeat(72));

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
