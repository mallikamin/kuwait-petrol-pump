const https = require('https');

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(conn.organizationId, prisma);

  const q = (query) => new Promise((resolve, reject) => {
    https.request({
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${conn.realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      timeout: 20000,
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    }).on('error', reject).end();
  });

  const accounts = await q("SELECT Id, Name, FullyQualifiedName, AccountType, AccountSubType, ParentRef, Active FROM Account WHERE Active = true MAXRESULTS 500");
  console.log('\n=== Chart of Accounts (active) ===');
  (accounts.QueryResponse?.Account || []).forEach(a => {
    console.log(`${a.Id.padStart(4)} | ${a.AccountType.padEnd(24)} | ${a.AccountSubType?.padEnd(24) || ''.padEnd(24)} | ${a.FullyQualifiedName}${a.ParentRef ? ' (parent=' + a.ParentRef.value + ')' : ''}`);
  });

  const items = await q("SELECT Id, Name, FullyQualifiedName, Type, IncomeAccountRef, ExpenseAccountRef, AssetAccountRef, ParentRef FROM Item WHERE Active = true MAXRESULTS 500");
  console.log('\n=== Items (active) ===');
  (items.QueryResponse?.Item || []).forEach(i => {
    const ia = i.IncomeAccountRef ? `income=${i.IncomeAccountRef.value}(${i.IncomeAccountRef.name})` : '';
    const ea = i.ExpenseAccountRef ? ` cogs=${i.ExpenseAccountRef.value}(${i.ExpenseAccountRef.name})` : '';
    const aa = i.AssetAccountRef ? ` asset=${i.AssetAccountRef.value}(${i.AssetAccountRef.name})` : '';
    console.log(`${i.Id.padStart(4)} | ${i.Type.padEnd(10)} | ${i.FullyQualifiedName.padEnd(40)} | ${ia}${ea}${aa}`);
  });

  const customers = await q("SELECT Id, DisplayName, Active FROM Customer WHERE Active = true MAXRESULTS 200");
  console.log('\n=== Customers (active) ===');
  (customers.QueryResponse?.Customer || []).forEach(c => console.log(`${c.Id.padStart(4)} | ${c.DisplayName}`));

  const vendors = await q("SELECT Id, DisplayName, Active, APAccountRef FROM Vendor WHERE Active = true");
  console.log('\n=== Vendors (active) ===');
  (vendors.QueryResponse?.Vendor || []).forEach(v => console.log(`${v.Id.padStart(4)} | ${v.DisplayName} | APAccount=${v.APAccountRef?.value || 'default'}`));

  await prisma.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
