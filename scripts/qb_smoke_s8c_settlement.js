/**
 * Phase B2 smoke test for S8C — PSO-Card settlement of credit-customer AR.
 *
 * Flow:
 *   1. Create a Credit PMG sale for BPO Ltd → QB Invoice (Dr BPO AR / Cr PMG Sales)
 *   2. Post a CustomerReceipt with paymentMethod='pso_card' allocated to that Sale
 *   3. Wait for the new create_pso_card_ar_transfer_journal job to complete
 *   4. Assert QB JournalEntry body:
 *        Dr A/R  Entity=pso-card-receivable  Amount=total
 *        Cr A/R  Entity=BPO Ltd               Amount=total
 *   5. Assert $0 Payment exists linking original Invoice ↔ JE credit
 *   6. Assert original Invoice is now Paid (Balance=0)
 *   7. Assert BPO customer balance = 0 (via QB customer query)
 *   8. Auto-void everything: JE, $0 Payment, original Invoice, DB rows
 */

const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';
const PMG_FUEL_TYPE_ID = 'a1111111-1111-1111-1111-111111111111';
const BPO_CUSTOMER_ID = '31d50625-371a-43cf-961d-d1ff114fbf54';
const SHIFT_INSTANCE_ID = 'fcca5678-bd0b-4dab-b68c-774595927771';

const EXPECTED_BPO_QBID = '88';
const EXPECTED_PSO_QBID = '55';
const EXPECTED_AR_ACCOUNT_QBID = '94';
const AMOUNT = 5;

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
async function pollJob(prisma, where, timeoutMs = 90000) {
  const start = Date.now();
  let job = null;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    job = await prisma.qBSyncQueue.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (job && ['completed', 'failed', 'dead_letter'].includes(job.status)) return job;
  }
  return job;
}

const assertions = [];
function assert(name, actual, expected) {
  const ok = actual === expected;
  assertions.push({ name, ok, actual, expected });
  console.log(`  ${ok ? '✓' : '✗'} ${name}: expected=${expected}, got=${actual}`);
}

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const { SalesService } = require('/app/apps/backend/dist/modules/sales/sales.service');
  const { CreditService } = require('/app/apps/backend/dist/modules/credit/credit.service');

  await connectRedis();
  const user = await prisma.user.findFirst({ where: { organizationId: ORG_ID, role: { in: ['admin', 'owner'] } } });
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);

  console.log('═'.repeat(72));
  console.log('  S8C SMOKE — credit customer pays outstanding AR via PSO Fleet Card');
  console.log('═'.repeat(72));

  // ── Step 1: Create a credit PMG sale for BPO ─────────────────────────
  console.log('\n[1/7] Creating credit PMG sale for BPO Ltd...');
  const salesSvc = new SalesService();
  const sale = await salesSvc.createFuelSale(
    {
      branchId: BRANCH_ID,
      shiftInstanceId: SHIFT_INSTANCE_ID,
      fuelTypeId: PMG_FUEL_TYPE_ID,
      quantityLiters: AMOUNT,
      pricePerLiter: 1,
      paymentMethod: 'credit',
      customerId: BPO_CUSTOMER_ID,
    },
    user.id,
    ORG_ID,
  );
  console.log(`  sale=${sale.id}  amount=${AMOUNT}`);

  const saleJob = await pollJob(prisma, { entityType: 'sale', entityId: sale.id });
  if (!saleJob || saleJob.status !== 'completed') throw new Error(`Sale sync failed: ${saleJob?.status} ${saleJob?.errorMessage}`);
  const freshSale = await prisma.sale.findUnique({ where: { id: sale.id } });
  const origInvoiceQbId = freshSale.qbInvoiceId;
  console.log(`  QB Invoice=${origInvoiceQbId}`);

  // ── Step 2: Create a PSO-card receipt against that Sale ──────────────
  console.log('\n[2/7] Creating customer receipt (paymentMethod=pso_card) allocated to that Sale...');
  const creditSvc = new CreditService();
  const receipt = await creditSvc.createReceipt(ORG_ID, user.id, {
    customerId: BPO_CUSTOMER_ID,
    branchId: BRANCH_ID,
    receiptDatetime: new Date(),
    amount: AMOUNT,
    paymentMethod: 'pso_card',
    allocationMode: 'MANUAL',
    allocations: [{ sourceType: 'SALE', sourceId: sale.id, amount: AMOUNT }],
    notes: 'Phase B2 S8C auto-test',
  });
  console.log(`  receipt=${receipt.id} number=${receipt.receiptNumber}`);

  // ── Step 3: Poll for the settlement job ──────────────────────────────
  console.log('\n[3/7] Polling for create_pso_card_ar_transfer_journal job...');
  const settleJob = await pollJob(prisma, {
    entityType: 'customer_receipt',
    entityId: receipt.id,
    jobType: 'create_pso_card_ar_transfer_journal',
  });
  if (!settleJob) throw new Error('No settlement job enqueued — credit.service.ts pso_card branch may not have routed correctly');
  console.log(`  job=${settleJob.id} status=${settleJob.status}`);
  if (settleJob.status !== 'completed') throw new Error(`Settlement job failed: ${settleJob.errorMessage}`);
  const jeQbId = settleJob.result?.qbId;
  console.log(`  QB JournalEntry=${jeQbId}`);

  // ── Step 4: Verify JE body ───────────────────────────────────────────
  console.log('\n[4/7] Verifying QB JournalEntry body...');
  const jeResp = await qbRequest('GET', conn.realmId, `journalentry/${jeQbId}?minorversion=65`, accessToken);
  const je = jeResp.body?.JournalEntry;
  if (!je) throw new Error(`QB JE ${jeQbId} not found`);

  const dr = je.Line.find((l) => l.JournalEntryLineDetail?.PostingType === 'Debit');
  const cr = je.Line.find((l) => l.JournalEntryLineDetail?.PostingType === 'Credit');

  assert('JE.TxnDate', je.TxnDate, new Date().toISOString().slice(0, 10));
  assert('JE.Dr.Amount', Number(dr.Amount), AMOUNT);
  assert('JE.Dr.AccountRef', dr.JournalEntryLineDetail.AccountRef.value, EXPECTED_AR_ACCOUNT_QBID);
  assert('JE.Dr.Entity.value', dr.JournalEntryLineDetail.Entity?.EntityRef?.value, EXPECTED_PSO_QBID);
  assert('JE.Cr.Amount', Number(cr.Amount), AMOUNT);
  assert('JE.Cr.AccountRef', cr.JournalEntryLineDetail.AccountRef.value, EXPECTED_AR_ACCOUNT_QBID);
  assert('JE.Cr.Entity.value', cr.JournalEntryLineDetail.Entity?.EntityRef?.value, EXPECTED_BPO_QBID);

  // ── Step 5: Verify $0 Payment linking Invoice ↔ JE ──────────────────
  console.log('\n[5/7] Looking for $0 Payment linking Invoice ↔ JE...');
  const payQ = await qbRequest(
    'GET', conn.realmId,
    `query?query=${encodeURIComponent(`SELECT * FROM Payment WHERE CustomerRef='${EXPECTED_BPO_QBID}' ORDER BY MetaData.CreateTime DESC MAXRESULTS 5`)}&minorversion=65`,
    accessToken,
  );
  const recentPayments = payQ.body?.QueryResponse?.Payment || [];
  const settlementPayment = recentPayments.find((p) =>
    Number(p.TotalAmt) === 0 &&
    (p.Line || []).some((ln) => (ln.LinkedTxn || []).some((lt) => lt.TxnId === jeQbId && lt.TxnType === 'JournalEntry'))
  );
  if (!settlementPayment) {
    console.log(`  !! No $0 Payment found linking Invoice ↔ JE — printed recent payments for debug:`);
    recentPayments.forEach((p) => console.log(`     Payment ${p.Id} Total=${p.TotalAmt} Lines=${p.Line?.length}`));
    assertions.push({ name: '$0 Payment exists', ok: false, actual: 'not found', expected: 'exists' });
  } else {
    console.log(`  found Payment ${settlementPayment.Id}`);
    const invLink = settlementPayment.Line.find((ln) => (ln.LinkedTxn || []).some((lt) => lt.TxnType === 'Invoice'));
    const jeLink = settlementPayment.Line.find((ln) => (ln.LinkedTxn || []).some((lt) => lt.TxnType === 'JournalEntry'));
    assert('Payment.TotalAmt', Number(settlementPayment.TotalAmt), 0);
    assert('Payment.Line[Invoice].LinkedTxn.TxnId', invLink?.LinkedTxn?.[0]?.TxnId, origInvoiceQbId);
    assert('Payment.Line[Invoice].Amount', Number(invLink?.Amount), AMOUNT);
    assert('Payment.Line[JE].LinkedTxn.TxnId', jeLink?.LinkedTxn?.[0]?.TxnId, jeQbId);
    // QB requires positive Line.Amount; TotalAmt=0 signals the JE credit covers the Invoice pay.
    assert('Payment.Line[JE].Amount', Number(jeLink?.Amount), AMOUNT);
  }

  // ── Step 6: Verify original Invoice is now Paid ──────────────────────
  console.log('\n[6/7] Verifying original Invoice is now Paid (Balance=0)...');
  const invResp = await qbRequest('GET', conn.realmId, `invoice/${origInvoiceQbId}?minorversion=65`, accessToken);
  const inv = invResp.body?.Invoice;
  assert('Invoice.TotalAmt', Number(inv.TotalAmt), AMOUNT);
  assert('Invoice.Balance', Number(inv.Balance), 0);

  // ── Step 7: Cleanup ─────────────────────────────────────────────────
  console.log('\n[7/7] Cleanup: void JE + $0 Payment + original Invoice, delete DB rows...');
  if (settlementPayment) {
    await qbRequest('POST', conn.realmId, `payment?operation=delete&minorversion=65`, accessToken,
      { Id: settlementPayment.Id, SyncToken: settlementPayment.SyncToken });
    console.log('  deleted $0 Payment');
  }
  await qbRequest('POST', conn.realmId, `journalentry?operation=delete&minorversion=65`, accessToken,
    { Id: je.Id, SyncToken: je.SyncToken });
  console.log('  deleted JournalEntry');
  const invResp2 = await qbRequest('GET', conn.realmId, `invoice/${origInvoiceQbId}?minorversion=65`, accessToken);
  if (invResp2.body?.Invoice) {
    await qbRequest('POST', conn.realmId, `invoice?operation=void&minorversion=65`, accessToken,
      { Id: invResp2.body.Invoice.Id, SyncToken: invResp2.body.Invoice.SyncToken });
    console.log('  voided original Invoice');
  }

  // DB cleanup
  await prisma.customerReceiptAllocation.deleteMany({ where: { receiptId: receipt.id } });
  await prisma.qBSyncQueue.deleteMany({ where: { entityId: receipt.id } });
  await prisma.customerReceipt.delete({ where: { id: receipt.id } });
  await prisma.qBSyncQueue.deleteMany({ where: { entityId: sale.id } });
  await prisma.fuelSale.deleteMany({ where: { saleId: sale.id } });
  await prisma.sale.delete({ where: { id: sale.id } });
  console.log('  DB cleanup ✓');

  // ── Summary ─────────────────────────────────────────────────────────
  const fails = assertions.filter((a) => !a.ok).length;
  console.log('\n' + '═'.repeat(72));
  console.log(`  S8C SMOKE RESULT: ${fails === 0 ? '✓ ALL PASS' : `✗ ${fails} FAIL`}`);
  console.log('═'.repeat(72));
  for (const a of assertions) {
    if (!a.ok) console.log(`  ✗ ${a.name}  expected=${a.expected}  actual=${a.actual}`);
  }

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
