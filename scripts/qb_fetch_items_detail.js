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

  // Fetch the 3 critical items fully
  const key = await q("SELECT * FROM Item WHERE Id IN ('105','106','82')");
  console.log('=== Key Items (105 HSD, 106 PMG, 82 Non-Fuel) ===');
  (key.QueryResponse?.Item || []).forEach(i => {
    console.log(JSON.stringify({
      Id: i.Id,
      Name: i.Name,
      FullyQualifiedName: i.FullyQualifiedName,
      Type: i.Type,
      TrackQtyOnHand: i.TrackQtyOnHand,
      QtyOnHand: i.QtyOnHand,
      IncomeAccountRef: i.IncomeAccountRef,
      ExpenseAccountRef: i.ExpenseAccountRef,
      AssetAccountRef: i.AssetAccountRef,
      ParentRef: i.ParentRef,
    }, null, 2));
  });

  // Fetch Jan 1-3 credit customers
  const customers = ['TESTNEWCUSTOMER8th April', 'TestXYZNew'];
  for (const name of customers) {
    const cs = await q(`SELECT Id, DisplayName, CompanyName, Active FROM Customer WHERE DisplayName = '${name.replace(/'/g, "''")}'`);
    console.log(`\n=== Customer '${name}' ===`);
    console.log(JSON.stringify(cs.QueryResponse?.Customer || 'not found', null, 2));
  }

  // Bank accounts detail
  const banks = await q("SELECT Id, Name, FullyQualifiedName, AccountType, AccountSubType FROM Account WHERE AccountType = 'Bank'");
  console.log('\n=== Bank Accounts ===');
  (banks.QueryResponse?.Account || []).forEach(a => console.log(`${a.Id} | ${a.FullyQualifiedName} (${a.AccountSubType})`));

  // Trade Payables + key liabilities
  const liabs = await q("SELECT Id, Name, AccountType, AccountSubType FROM Account WHERE AccountType IN ('Accounts Payable','Accounts Receivable','Other Current Liability') MAXRESULTS 50");
  console.log('\n=== AP/AR/Liability accounts ===');
  (liabs.QueryResponse?.Account || []).forEach(a => console.log(`${a.Id} | ${a.AccountType} | ${a.Name}`));

  await prisma.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
