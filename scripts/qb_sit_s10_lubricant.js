/**
 * Live SIT for S10 (non-fuel product Bill) against production QB.
 *
 * Flow:
 *  1. Discover branch + user + any existing non-fuel product
 *  2. Create tiny PO (1 unit @ PKR 1) from PSO
 *  3. Fully receive via StockReceiptService (triggers QB enqueue)
 *  4. Poll queue until job completes (or timeout)
 *  5. Fetch the created QB Bill, assert APAccountRef=132, ItemRef=82 (alias)
 *  6. Void the QB Bill, reverse stock_level, delete receipt + PO
 *
 * Non-zero exit code on any assertion failure.
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const PSO_LOCAL_ID = '0c8711c7-da2e-4788-a467-29fb37d79c6a';
const EXPECTED_AP_QBID = '132';
const EXPECTED_ITEM_ALIAS_QBID = '82';

function qbRequest(method, realm, pathSuffix, accessToken, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${realm}/${pathSuffix}`,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    };
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, body: buf });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const { StockReceiptService } = require('/app/apps/backend/dist/modules/purchase-orders/stock-receipt.service');

  // ---- Discovery ----
  const branch = await prisma.branch.findFirst({ where: { organizationId: ORG_ID } });
  if (!branch) throw new Error('no branch found');
  const user = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: { in: ['admin', 'owner'] } },
  });
  if (!user) throw new Error('no admin user found');
  const product = await prisma.product.findFirst({ where: { organizationId: ORG_ID } });
  if (!product) throw new Error('no product found');
  console.log(`[SIT] branch=${branch.id} user=${user.id} product=${product.id} (${product.name})`);

  // ---- Create tiny PO ----
  const poNumber = `SIT-S10-${Date.now()}`;
  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: ORG_ID,
      branchId: branch.id,
      supplierId: PSO_LOCAL_ID,
      poNumber,
      orderDate: new Date(),
      status: 'confirmed',
      totalAmount: 1,
      items: {
        create: [
          {
            itemType: 'product',
            productId: product.id,
            quantityOrdered: 1,
            costPerUnit: 1,
            totalCost: 1,
          },
        ],
      },
    },
    include: { items: true },
  });
  console.log(`[SIT] Created PO ${po.id} (${poNumber})`);

  // ---- Snapshot stock_level for cleanup ----
  const stockBefore = await prisma.stockLevel.findUnique({
    where: { productId_branchId: { productId: product.id, branchId: branch.id } },
  });
  console.log(`[SIT] stockLevel before: ${stockBefore ? Number(stockBefore.quantity) : 'none'}`);

  // ---- Receive full stock (triggers QB enqueue) ----
  const svc = new StockReceiptService();
  const receipt = await svc.receiveStock(po.id, ORG_ID, user.id, {
    receiptNumber: `SIT-RCPT-${Date.now()}`,
    receiptDate: new Date(),
    items: po.items.map((i) => ({ poItemId: i.id, quantityReceived: Number(i.quantityOrdered) })),
    notes: 'SIT S10 auto-test',
  });
  console.log(`[SIT] Receipt ${receipt.id} created, waiting for QB queue...`);

  // ---- Poll queue up to 60s ----
  let job = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await prisma.qBSyncQueue.findFirst({
      where: { entityId: po.id, entityType: 'purchase_order' },
    });
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'dead_letter')) break;
    if (job) console.log(`[SIT] Queue status: ${job.status} (retry ${i + 1}/30)`);
  }
  if (!job) throw new Error('Queue job was never created');
  console.log(`[SIT] Final job status: ${job.status}`);
  if (job.status !== 'completed') {
    throw new Error(`Job did not complete: status=${job.status} error=${job.errorMessage || 'n/a'}`);
  }

  const freshPo = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
  console.log(`[SIT] PO.qbBillId=${freshPo.qbBillId} qbSynced=${freshPo.qbSynced}`);
  if (!freshPo.qbBillId || !freshPo.qbSynced) throw new Error('PO not marked synced');

  // ---- Verify Bill in QB ----
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);
  const billResp = await qbRequest('GET', conn.realmId, `bill/${freshPo.qbBillId}?minorversion=65`, accessToken);
  const bill = billResp.body && billResp.body.Bill;
  if (!bill) throw new Error(`QB Bill not found: ${JSON.stringify(billResp.body).slice(0, 300)}`);

  console.log('\n[SIT] === QB Bill ===');
  console.log('Id:', bill.Id);
  console.log('DocNumber:', bill.DocNumber);
  console.log('TotalAmt:', bill.TotalAmt);
  console.log('VendorRef:', JSON.stringify(bill.VendorRef));
  console.log('APAccountRef:', JSON.stringify(bill.APAccountRef));
  console.log('Line[0]:', JSON.stringify(bill.Line && bill.Line[0], null, 2));

  const failures = [];
  if (bill.VendorRef?.value !== '78') failures.push(`VendorRef.value expected 78, got ${bill.VendorRef?.value}`);
  if (bill.APAccountRef?.value !== EXPECTED_AP_QBID)
    failures.push(`APAccountRef.value expected ${EXPECTED_AP_QBID}, got ${bill.APAccountRef?.value}`);
  if (bill.Line?.[0]?.DetailType !== 'ItemBasedExpenseLineDetail')
    failures.push(`Line[0].DetailType expected ItemBasedExpenseLineDetail`);
  if (bill.Line?.[0]?.ItemBasedExpenseLineDetail?.ItemRef?.value !== EXPECTED_ITEM_ALIAS_QBID)
    failures.push(
      `ItemRef.value expected ${EXPECTED_ITEM_ALIAS_QBID}, got ${bill.Line?.[0]?.ItemBasedExpenseLineDetail?.ItemRef?.value}`,
    );
  if (Number(bill.TotalAmt) !== 1) failures.push(`TotalAmt expected 1, got ${bill.TotalAmt}`);

  if (failures.length) {
    console.error('\n[SIT] ASSERTIONS FAILED:');
    failures.forEach((f) => console.error('  -', f));
  } else {
    console.log('\n[SIT] ✓ All Bill assertions passed');
  }

  // ---- Cleanup: void QB Bill ----
  console.log('\n[SIT] Cleanup: voiding QB Bill...');
  const voidResp = await qbRequest(
    'POST',
    conn.realmId,
    `bill?operation=void&minorversion=65`,
    accessToken,
    { Id: bill.Id, SyncToken: bill.SyncToken },
  );
  console.log('[SIT] Void status:', voidResp.status, '| new status:',
    voidResp.body?.Bill?.PrivateNote || voidResp.body?.Bill?.VoidReason || 'voided');

  // ---- Cleanup: DB ----
  await prisma.stockReceiptItem.deleteMany({ where: { stockReceiptId: receipt.id } });
  await prisma.stockReceipt.deleteMany({ where: { id: receipt.id } });

  if (stockBefore) {
    await prisma.stockLevel.update({
      where: { productId_branchId: { productId: product.id, branchId: branch.id } },
      data: { quantity: stockBefore.quantity },
    });
    console.log(`[SIT] Restored stockLevel to ${Number(stockBefore.quantity)}`);
  } else {
    await prisma.stockLevel.deleteMany({
      where: { productId: product.id, branchId: branch.id },
    });
    console.log('[SIT] Deleted stockLevel row (was absent before)');
  }

  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
  await prisma.qBSyncQueue.deleteMany({ where: { entityId: po.id, entityType: 'purchase_order' } });
  await prisma.purchaseOrder.delete({ where: { id: po.id } });

  console.log('[SIT] DB cleanup complete');

  if (failures.length) process.exit(1);
  await prisma.$disconnect();
})().catch((e) => {
  console.error('[SIT] FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
