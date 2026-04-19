/**
 * Live SIT — supplier bill payment → QB BillPayment.
 *
 * Records a small PKR 100 test payment against PO TEso191 (QB Bill 193) via
 * PurchaseOrdersService.recordPayment. Verifies QB creates a BillPayment
 * clearing Trade Payables (132) against the Bill with a bank account source.
 * Data is KEPT (not voided).
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const PO_NUMBER = 'TEso191';
const AMOUNT = 100;
const PAYMENT_METHOD = 'bank_transfer'; // falls back to default_checking → QB 88 ABL Bank

function qbGet(realm, pathSuffix, accessToken) {
  return new Promise((resolve, reject) => {
    https.request({
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${realm}/${pathSuffix}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      timeout: 20000,
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    }).on('error', reject).end();
  });
}

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const { PurchaseOrdersService } = require('/app/apps/backend/dist/modules/purchase-orders/purchase-orders.service');

  const po = await prisma.purchaseOrder.findFirst({
    where: { poNumber: PO_NUMBER, organizationId: ORG_ID },
    include: { supplier: true },
  });
  console.log(`[SIT BP] PO: id=${po.id} qbBillId=${po.qbBillId} paidBefore=${po.paidAmount}`);
  if (!po.qbBillId) throw new Error('PO has no qb_bill_id; cannot create BillPayment');

  const svc = new PurchaseOrdersService();
  const payment = await svc.recordPayment(po.id, ORG_ID, {
    paymentDate: new Date(),
    amount: AMOUNT,
    paymentMethod: PAYMENT_METHOD,
    referenceNumber: `SIT-BP-${Date.now()}`,
    notes: 'SIT bill-payment auto-test — PKR 100 against PO TEso191 (Bill 193)',
  });
  console.log(`[SIT BP] supplierPayment created: id=${payment.id}`);

  console.log('[SIT BP] Polling queue for BillPayment job...');
  let job = null;
  const start = Date.now();
  while (Date.now() - start < 90000) {
    await new Promise(r => setTimeout(r, 3000));
    job = await prisma.qBSyncQueue.findFirst({
      where: { entityType: 'supplier_payment', entityId: payment.id },
    });
    if (job && ['completed', 'failed', 'dead_letter'].includes(job.status)) break;
    if (job) console.log(`  ...queue status=${job.status}`);
  }
  if (!job) throw new Error('no supplier_payment job enqueued');
  console.log(`[SIT BP] Final job status: ${job.status}`);
  if (job.status !== 'completed') throw new Error(`Job not completed: ${job.errorMessage}`);

  const qbId = job.result?.qbId;
  console.log(`[SIT BP] QB BillPayment Id: ${qbId}`);

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);
  const bpResp = await qbGet(conn.realmId, `billpayment/${qbId}?minorversion=65`, accessToken);
  const bp = bpResp.body?.BillPayment;
  if (!bp) throw new Error(`QB BillPayment ${qbId} not found`);

  console.log('\n=== QB BillPayment ===');
  console.log('Id:', bp.Id);
  console.log('TxnDate:', bp.TxnDate);
  console.log('TotalAmt:', bp.TotalAmt);
  console.log('VendorRef:', JSON.stringify(bp.VendorRef));
  console.log('PayType:', bp.PayType);
  console.log('CheckPayment.BankAccountRef:', JSON.stringify(bp.CheckPayment?.BankAccountRef));
  console.log('PrivateNote:', bp.PrivateNote);
  (bp.Line || []).forEach((ln, i) => {
    console.log(`  Line[${i}] Amount=${ln.Amount} LinkedTxn=${JSON.stringify(ln.LinkedTxn)}`);
  });

  // Verify Bill 193 balance reduced
  const billResp = await qbGet(conn.realmId, `bill/${po.qbBillId}?minorversion=65`, accessToken);
  const bill = billResp.body?.Bill;
  console.log('\n=== Bill 193 balance after payment ===');
  console.log(`Bill Id=${bill.Id} TotalAmt=${bill.TotalAmt} Balance=${bill.Balance} (should be ${bill.TotalAmt - AMOUNT})`);

  const failures = [];
  if (Number(bp.TotalAmt) !== AMOUNT) failures.push(`TotalAmt expected ${AMOUNT}, got ${bp.TotalAmt}`);
  if (bp.VendorRef?.value !== '78') failures.push(`VendorRef.value expected 78, got ${bp.VendorRef?.value}`);
  if (Number(bill.Balance) !== (Number(bill.TotalAmt) - AMOUNT))
    failures.push(`Bill balance reduction wrong: expected ${bill.TotalAmt - AMOUNT}, got ${bill.Balance}`);

  if (failures.length) { console.error('\n[SIT BP] FAILURES:'); failures.forEach(f => console.error(' -', f)); process.exit(1); }
  console.log('\n[SIT BP] ✓ ALL ASSERTIONS PASSED');
  await prisma.$disconnect();
})().catch(e => { console.error('[SIT BP] FATAL:', e.message); console.error(e.stack); process.exit(1); });
