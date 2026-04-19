const https = require('https');

const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';

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
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(ORG_ID, prisma);

  // Poll
  console.log('Polling queue...');
  const start = Date.now();
  while (Date.now() - start < 240000) {
    const counts = await prisma.qBSyncQueue.groupBy({
      by: ['status'],
      where: { organizationId: ORG_ID, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      _count: { _all: true },
    });
    const s = counts.map(c => `${c.status}=${c._count._all}`).join(' ');
    const pending = counts.find(c => c.status === 'pending' || c.status === 'processing');
    console.log(`  ${Math.round((Date.now() - start) / 1000)}s | ${s}`);
    if (!pending) break;
    await new Promise(r => setTimeout(r, 5000));
  }

  const jobs = await prisma.qBSyncQueue.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n=== ALL JOBS (last 60 min) ===');
  for (const j of jobs) {
    const qbId = j.result?.qbId || j.result?.qbEntity || '';
    const orig = j.payload?.demoNoteOriginalDate || '';
    const jan = orig ? ` (POS date: ${orig})` : '';
    console.log(`[${j.status.padEnd(10)}] ${j.entityType}/${j.jobType.padEnd(22)} | qb=${qbId.padEnd(6)} | entity=${String(j.entityId).slice(0,8)}${jan} | ${j.errorMessage?.slice(0,80) || ''}`);
  }

  // Fetch each successful QB doc to get full detail (line accounts, totals)
  console.log('\n=== QB DOC DETAILS ===');
  const successful = jobs.filter(j => j.status === 'completed');
  for (const j of successful) {
    const qbId = j.result?.qbId;
    if (!qbId) continue;
    let endpoint;
    if (j.jobType === 'create_sales_receipt') endpoint = `salesreceipt/${qbId}?minorversion=65`;
    else if (j.jobType === 'create_invoice') endpoint = `invoice/${qbId}?minorversion=65`;
    else if (j.jobType === 'create_bill') endpoint = `bill/${qbId}?minorversion=65`;
    else continue;
    const resp = await qbGet(conn.realmId, endpoint, accessToken);
    const doc = resp.body?.SalesReceipt || resp.body?.Invoice || resp.body?.Bill;
    if (!doc) { console.log(`  [miss] could not fetch ${j.jobType} ${qbId}`); continue; }
    console.log(`\n--- ${j.jobType} #${doc.Id} ---`);
    console.log(`  DocNumber: ${doc.DocNumber || 'n/a'} | TxnDate: ${doc.TxnDate} | Total: ${doc.TotalAmt}`);
    if (doc.CustomerRef) console.log(`  CustomerRef: ${doc.CustomerRef.value} (${doc.CustomerRef.name})`);
    if (doc.VendorRef) console.log(`  VendorRef: ${doc.VendorRef.value} (${doc.VendorRef.name})`);
    if (doc.DepositToAccountRef) console.log(`  DepositToAccount: ${doc.DepositToAccountRef.value} (${doc.DepositToAccountRef.name})`);
    if (doc.APAccountRef) console.log(`  APAccountRef: ${doc.APAccountRef.value} (${doc.APAccountRef.name})`);
    if (doc.ARAccountRef) console.log(`  ARAccountRef: ${doc.ARAccountRef.value} (${doc.ARAccountRef.name})`);
    if (doc.PaymentMethodRef) console.log(`  PaymentMethodRef: ${doc.PaymentMethodRef.value} (${doc.PaymentMethodRef.name})`);
    console.log(`  PrivateNote: ${doc.PrivateNote || ''}`);
    (doc.Line || []).forEach((ln, i) => {
      const d = ln.SalesItemLineDetail || ln.ItemBasedExpenseLineDetail;
      if (!d) return;
      console.log(`  Line[${i}]: Item ${d.ItemRef?.value} (${d.ItemRef?.name}) | Qty ${d.Qty} @ ${d.UnitPrice} = ${ln.Amount}`);
    });
  }

  await prisma.$disconnect();
  console.log('\n=== DONE ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
