// Fetch a QB SalesReceipt/Invoice and print the line items — used to verify
// that per-product QB Item routing landed correctly.
const https = require('https');
const { prisma } = require('/app/apps/backend/dist/config/database');
const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

const QB_ID = process.argv[2];
const DOC_TYPE = (process.argv[3] || 'salesreceipt').toLowerCase();
if (!QB_ID) {
  console.error('Usage: node qb_verify_sale_line.js <qbId> [salesreceipt|invoice]');
  process.exit(1);
}

function fetchQB(realmId, accessToken, path) {
  return new Promise((resolve, reject) => {
    https
      .request(
        {
          hostname: 'quickbooks.api.intuit.com',
          path: `/v3/company/${realmId}/${path}?minorversion=65`,
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
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
      )
      .on('error', reject)
      .end();
  });
}

(async () => {
  await connectRedis();
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const tok = await getValidAccessToken(conn.organizationId);

  // Try salesreceipt first, fall back to invoice
  const typeEntity = DOC_TYPE === 'invoice' ? 'Invoice' : 'SalesReceipt';
  const typePath = DOC_TYPE === 'invoice' ? 'invoice' : 'salesreceipt';
  const r = await fetchQB(conn.realmId, tok.accessToken, `${typePath}/${QB_ID}`);
  if (r.status !== 200) {
    console.log(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`);
    process.exit(1);
  }
  const doc = r.body[typeEntity];
  console.log(`${typeEntity} ${doc.Id}: TotalAmt=${doc.TotalAmt} TxnDate=${doc.TxnDate}`);
  console.log(`Customer: ${doc.CustomerRef?.name || doc.CustomerRef?.value}`);
  console.log(`Payment: ${doc.PaymentMethodRef?.name || ''} → ${doc.DepositToAccountRef?.name || ''}`);
  console.log('Lines:');
  for (const line of doc.Line || []) {
    const detail = line.SalesItemLineDetail || line.JournalEntryLineDetail;
    const itemRef = detail?.ItemRef;
    console.log(`  Amount=${line.Amount}  Item={id:${itemRef?.value}, name:"${itemRef?.name}"}  Desc="${line.Description || ''}"  Qty=${detail?.Qty} @ ${detail?.UnitPrice}`);
  }

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
