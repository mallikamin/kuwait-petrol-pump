/**
 * Live SIT — credit customer receipt → QB ReceivePayment.
 *
 * Creates one small POS receipt (1360 PKR) against the Jan 1 credit Invoice
 * for TESTNEWCUSTOMER8th April (sale 2dcff374 → QB Invoice 183). Verifies
 * QB creates a ReceivePayment clearing the Invoice. Data is KEPT (not voided).
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';
const CUSTOMER_LOCAL_ID = '72dd244a-6f06-4a28-a35d-37b2cceac69b';  // TESTNEWCUSTOMER8th April
const TARGET_SALE_ID = '9a950a39-c4bc-42e2-822e-30d6431a0c1b';     // Invoice 180, 3664 PKR PMG
const AMOUNT = 3664;

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
  const { CreditService } = require('/app/apps/backend/dist/modules/credit/credit.service');

  const user = await prisma.user.findFirst({ where: { organizationId: ORG_ID, role: { in: ['admin', 'owner'] } } });
  const sale = await prisma.sale.findUnique({ where: { id: TARGET_SALE_ID } });
  console.log(`[SIT S8] Target Sale: id=${sale.id} qbInvoiceId=${sale.qbInvoiceId} amount=${sale.totalAmount}`);
  if (!sale.qbInvoiceId) throw new Error('target sale has no qb_invoice_id; backfill first');

  const svc = new CreditService();
  const receipt = await svc.createReceipt(ORG_ID, user.id, {
    customerId: CUSTOMER_LOCAL_ID,
    branchId: BRANCH_ID,
    receiptDatetime: new Date(),
    amount: AMOUNT,
    paymentMethod: 'cash',
    allocationMode: 'MANUAL',
    allocations: [
      { sourceType: 'SALE', sourceId: TARGET_SALE_ID, amount: AMOUNT },
    ],
    notes: 'SIT S8 auto-test — clears Jan 1 PMG 8L credit invoice 180',
  });
  console.log(`[SIT S8] Receipt created: id=${receipt.id} number=${receipt.receiptNumber}`);

  console.log('[SIT S8] Polling queue for ReceivePayment job...');
  let job = null;
  const start = Date.now();
  while (Date.now() - start < 90000) {
    await new Promise(r => setTimeout(r, 3000));
    job = await prisma.qBSyncQueue.findFirst({
      where: { entityType: 'customer_payment', entityId: receipt.id },
    });
    if (job && ['completed', 'failed', 'dead_letter'].includes(job.status)) break;
    if (job) console.log(`  ...queue status=${job.status}`);
  }
  if (!job) throw new Error('no customer_payment job enqueued — check logs');
  console.log(`[SIT S8] Final job status: ${job.status}`);
  if (job.status !== 'completed') throw new Error(`Job not completed: ${job.errorMessage}`);

  const qbId = job.result?.qbId;
  console.log(`[SIT S8] QB Payment Id: ${qbId}`);

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);
  const paymentResp = await qbGet(conn.realmId, `payment/${qbId}?minorversion=65`, accessToken);
  const payment = paymentResp.body?.Payment;
  if (!payment) throw new Error(`QB Payment ${qbId} not found`);

  console.log('\n=== QB ReceivePayment ===');
  console.log('Id:', payment.Id);
  console.log('TxnDate:', payment.TxnDate);
  console.log('TotalAmt:', payment.TotalAmt);
  console.log('CustomerRef:', JSON.stringify(payment.CustomerRef));
  console.log('DepositToAccountRef:', JSON.stringify(payment.DepositToAccountRef));
  console.log('ARAccountRef:', JSON.stringify(payment.ARAccountRef));
  console.log('PrivateNote:', payment.PrivateNote);
  (payment.Line || []).forEach((ln, i) => {
    console.log(`  Line[${i}] Amount=${ln.Amount} LinkedTxn=${JSON.stringify(ln.LinkedTxn)}`);
  });

  // Verify Invoice 183 is now cleared
  const invResp = await qbGet(conn.realmId, `invoice/${sale.qbInvoiceId}?minorversion=65`, accessToken);
  const inv = invResp.body?.Invoice;
  console.log('\n=== Invoice 180 balance after payment ===');
  console.log(`Invoice Id=${inv.Id} TotalAmt=${inv.TotalAmt} Balance=${inv.Balance} (should be 0)`);

  const failures = [];
  if (Number(payment.TotalAmt) !== AMOUNT) failures.push(`TotalAmt expected ${AMOUNT}, got ${payment.TotalAmt}`);
  if (payment.CustomerRef?.value !== '79') failures.push(`CustomerRef.value expected 79, got ${payment.CustomerRef?.value}`);
  if (Number(inv.Balance) !== 0) failures.push(`Invoice 180 Balance expected 0 (cleared), got ${inv.Balance}`);

  if (failures.length) { console.error('\n[SIT S8] FAILURES:'); failures.forEach(f => console.error(' -', f)); process.exit(1); }
  console.log('\n[SIT S8] ✓ ALL ASSERTIONS PASSED');
  await prisma.$disconnect();
})().catch(e => { console.error('[SIT S8] FATAL:', e.message); console.error(e.stack); process.exit(1); });
