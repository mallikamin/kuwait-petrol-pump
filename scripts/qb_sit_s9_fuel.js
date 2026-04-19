/**
 * Live SIT for S9 (fuel tanker receipt Bill) against production QB.
 *
 * 1 L HSD @ 1 PKR — asserts Bill uses HSD item mapping (qb_id=105),
 * not the non-fuel alias. Fuel inventory (current_stock, avg_cost)
 * is snapshotted and restored after test.
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const PSO_LOCAL_ID = '0c8711c7-da2e-4788-a467-29fb37d79c6a';
const HSD_FUEL_TYPE_ID = 'a2222222-2222-2222-2222-222222222222';
const EXPECTED_AP_QBID = '132';
const EXPECTED_HSD_QBID = '105';

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
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
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

  const branch = await prisma.branch.findFirst({ where: { organizationId: ORG_ID } });
  const user = await prisma.user.findFirst({ where: { organizationId: ORG_ID, role: { in: ['admin', 'owner'] } } });
  console.log(`[SIT S9] branch=${branch.id} user=${user.id} fuelType=HSD`);

  // Snapshot HSD fuel_inventory
  const invBefore = await prisma.fuelInventory.findUnique({
    where: { branchId_fuelTypeId: { branchId: branch.id, fuelTypeId: HSD_FUEL_TYPE_ID } },
  });
  console.log(`[SIT S9] HSD inventory before: stock=${invBefore ? Number(invBefore.currentStock) : 'none'} avgCost=${invBefore ? Number(invBefore.avgCostPerLiter) : 'n/a'}`);

  const poNumber = `SIT-S9-${Date.now()}`;
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
        create: [{
          itemType: 'fuel',
          fuelTypeId: HSD_FUEL_TYPE_ID,
          quantityOrdered: 1,
          costPerUnit: 1,
          totalCost: 1,
        }],
      },
    },
    include: { items: true },
  });
  console.log(`[SIT S9] Created PO ${po.id} (${poNumber})`);

  const svc = new StockReceiptService();
  const receipt = await svc.receiveStock(po.id, ORG_ID, user.id, {
    receiptNumber: `SIT-RCPT-S9-${Date.now()}`,
    receiptDate: new Date(),
    items: po.items.map((i) => ({ poItemId: i.id, quantityReceived: Number(i.quantityOrdered) })),
    notes: 'SIT S9 auto-test',
  });
  console.log(`[SIT S9] Receipt ${receipt.id}, polling queue...`);

  let job = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await prisma.qBSyncQueue.findFirst({ where: { entityId: po.id, entityType: 'purchase_order' } });
    if (job && ['completed', 'failed', 'dead_letter'].includes(job.status)) break;
  }
  if (!job) throw new Error('Queue job never created');
  console.log(`[SIT S9] Final job status: ${job.status}`);
  if (job.status !== 'completed') throw new Error(`Job failed: ${job.errorMessage}`);

  const freshPo = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
  console.log(`[SIT S9] PO.qbBillId=${freshPo.qbBillId} qbSynced=${freshPo.qbSynced}`);

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);
  const billResp = await qbRequest('GET', conn.realmId, `bill/${freshPo.qbBillId}?minorversion=65`, accessToken);
  const bill = billResp.body?.Bill;
  if (!bill) throw new Error(`Bill not found: ${JSON.stringify(billResp.body).slice(0, 300)}`);

  console.log('\n[SIT S9] === QB Bill ===');
  console.log('Id:', bill.Id, '| TotalAmt:', bill.TotalAmt);
  console.log('VendorRef:', JSON.stringify(bill.VendorRef));
  console.log('APAccountRef:', JSON.stringify(bill.APAccountRef));
  console.log('Line[0]:', JSON.stringify(bill.Line?.[0], null, 2));

  const failures = [];
  if (bill.VendorRef?.value !== '78') failures.push(`VendorRef.value expected 78, got ${bill.VendorRef?.value}`);
  if (bill.APAccountRef?.value !== EXPECTED_AP_QBID) failures.push(`APAccountRef.value expected ${EXPECTED_AP_QBID}, got ${bill.APAccountRef?.value}`);
  if (bill.Line?.[0]?.DetailType !== 'ItemBasedExpenseLineDetail') failures.push(`Line[0].DetailType wrong`);
  if (bill.Line?.[0]?.ItemBasedExpenseLineDetail?.ItemRef?.value !== EXPECTED_HSD_QBID)
    failures.push(`ItemRef.value expected ${EXPECTED_HSD_QBID} (HSD), got ${bill.Line?.[0]?.ItemBasedExpenseLineDetail?.ItemRef?.value}`);
  if (Number(bill.TotalAmt) !== 1) failures.push(`TotalAmt expected 1, got ${bill.TotalAmt}`);

  if (failures.length) { console.error('\n[SIT S9] ASSERTIONS FAILED:'); failures.forEach(f => console.error('  -', f)); }
  else { console.log('\n[SIT S9] ✓ All Bill assertions passed'); }

  // Cleanup: void QB Bill
  console.log('\n[SIT S9] Voiding QB Bill...');
  const voidResp = await qbRequest('POST', conn.realmId, `bill?operation=void&minorversion=65`, accessToken,
    { Id: bill.Id, SyncToken: bill.SyncToken });
  console.log('[SIT S9] Void status:', voidResp.status);

  // Cleanup DB: receipt → inventory restore → PO
  await prisma.stockReceiptItem.deleteMany({ where: { stockReceiptId: receipt.id } });
  await prisma.stockReceipt.deleteMany({ where: { id: receipt.id } });

  // Restore fuel inventory exactly as snapshot
  if (invBefore) {
    await prisma.fuelInventory.update({
      where: { branchId_fuelTypeId: { branchId: branch.id, fuelTypeId: HSD_FUEL_TYPE_ID } },
      data: {
        currentStock: invBefore.currentStock,
        avgCostPerLiter: invBefore.avgCostPerLiter,
        lastReceiptDate: invBefore.lastReceiptDate,
      },
    });
    console.log(`[SIT S9] Restored HSD inventory to stock=${Number(invBefore.currentStock)} avgCost=${Number(invBefore.avgCostPerLiter)}`);
  } else {
    await prisma.fuelInventory.deleteMany({
      where: { branchId: branch.id, fuelTypeId: HSD_FUEL_TYPE_ID },
    });
    console.log('[SIT S9] Deleted fuel_inventory row (was absent)');
  }

  // Delete the fuel_inventory_transaction for this PO
  await prisma.fuelInventoryTransaction.deleteMany({
    where: { referenceType: 'purchase_order', referenceId: po.id },
  });

  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
  await prisma.qBSyncQueue.deleteMany({ where: { entityId: po.id, entityType: 'purchase_order' } });
  await prisma.purchaseOrder.delete({ where: { id: po.id } });

  console.log('[SIT S9] DB cleanup complete');

  if (failures.length) process.exit(1);
  await prisma.$disconnect();
})().catch((e) => { console.error('[SIT S9] FATAL:', e.message); console.error(e.stack); process.exit(1); });
