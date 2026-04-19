const https = require('https');

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(conn.organizationId, prisma);
  const realm = conn.realmId;

  const probe = (path) => new Promise((resolve, reject) => {
    https.request({
      hostname: 'quickbooks.api.intuit.com',
      path,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    }).on('error', reject).end();
  });

  const acct = await probe('/v3/company/' + realm + '/account/132?minorversion=65');
  console.log('--- GET /account/132 ---');
  console.log('status:', acct.status);
  if (acct.body && acct.body.Account) {
    const a = acct.body.Account;
    console.log('Id:', a.Id);
    console.log('Name:', a.Name);
    console.log('AccountType:', a.AccountType);
    console.log('AccountSubType:', a.AccountSubType);
    console.log('Active:', a.Active);
    console.log('CurrentBalance:', a.CurrentBalance);
  } else {
    console.log(JSON.stringify(acct.body).slice(0, 500));
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
