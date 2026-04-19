const https = require('https');

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  if (!conn) { console.error('no active qb connection'); process.exit(1); }
  const { accessToken } = await getValidAccessToken(conn.organizationId, prisma);

  const realm = conn.realmId;
  console.log('realmId:', realm);

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

  // 1) Direct fetch by Id=78
  const byId = await probe('/v3/company/' + realm + '/vendor/78?minorversion=65');
  console.log('\n--- GET /vendor/78 ---');
  console.log('status:', byId.status);
  if (byId.body && byId.body.Vendor) {
    const v = byId.body.Vendor;
    console.log('Id:', v.Id);
    console.log('DisplayName:', v.DisplayName);
    console.log('CompanyName:', v.CompanyName);
    console.log('Active:', v.Active);
    console.log('APAccountRef:', JSON.stringify(v.APAccountRef));
  } else {
    console.log(JSON.stringify(byId.body).slice(0, 500));
  }

  // 2) Search by DisplayName = PSO (cross-check)
  const q = "SELECT Id, DisplayName, CompanyName, Active, APAccountRef FROM Vendor WHERE DisplayName = 'PSO' OR CompanyName = 'PSO'";
  const search = await probe('/v3/company/' + realm + '/query?query=' + encodeURIComponent(q) + '&minorversion=65');
  console.log('\n--- Query WHERE DisplayName/CompanyName = PSO ---');
  console.log('status:', search.status);
  console.log(JSON.stringify(search.body && search.body.QueryResponse && search.body.QueryResponse.Vendor || search.body, null, 2));

  await prisma.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
