// One-shot diagnostic: list QB accounts of the three types the bootstrap
// cares about (AR / AP / Other Current Liability) + dump the expense
// chart under Admin Expenses, so we can see what's actually named what
// in this QB realm.
const https = require('https');
const { prisma } = require('/app/apps/backend/dist/config/database');
const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

function qbQuery(realmId, accessToken, query) {
  return new Promise((resolve, reject) => {
    https
      .request(
        {
          hostname: 'quickbooks.api.intuit.com',
          path: `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          timeout: 20000,
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => {
            try { resolve(JSON.parse(b)); }
            catch { resolve(b); }
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

  console.log('Realm:', conn.realmId);
  console.log();

  console.log('--- A/R, A/P, Other Current Liability ---');
  const r1 = await qbQuery(
    conn.realmId,
    tok.accessToken,
    "SELECT Id, Name, FullyQualifiedName, AccountType, AccountSubType FROM Account WHERE AccountType IN ('Accounts Receivable', 'Accounts Payable', 'Other Current Liability') ORDER BY AccountType, Name MAXRESULTS 200",
  );
  const rows1 = ((r1.QueryResponse || {}).Account) || [];
  console.log(`Found ${rows1.length}`);
  for (const r of rows1) {
    console.log(`  ${String(r.AccountType).padEnd(28)} ${String(r.Name).padEnd(40)} (id=${r.Id})`);
  }

  console.log();
  console.log('--- Admin Expenses sub-accounts ---');
  const r2 = await qbQuery(
    conn.realmId,
    tok.accessToken,
    "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE FullyQualifiedName LIKE 'Admin Expenses%' ORDER BY FullyQualifiedName MAXRESULTS 500",
  );
  const rows2 = ((r2.QueryResponse || {}).Account) || [];
  console.log(`Found ${rows2.length}`);
  for (const r of rows2) {
    console.log(`  ${String(r.FullyQualifiedName).padEnd(60)} (id=${r.Id})`);
  }

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
})().catch((e) => {
  console.error('ERR:', e && e.message ? e.message : e);
  process.exit(1);
});
