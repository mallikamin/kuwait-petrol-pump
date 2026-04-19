const https = require('https');

(async () => {
  const { prisma } = require('/app/apps/backend/dist/config/database');
  const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true } });
  const { accessToken } = await getValidAccessToken(conn.organizationId, prisma);

  const q = (path) => new Promise((resolve, reject) => {
    https.request({
      hostname: 'quickbooks.api.intuit.com',
      path: `/v3/company/${conn.realmId}/${path}&minorversion=65`.replace(/\?$/, ''),
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      timeout: 20000,
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    }).on('error', reject).end();
  });

  // CompanyInfo
  const ci = await q("companyinfo/" + conn.realmId + "?");
  console.log('=== CompanyInfo ===');
  const c = ci.body?.CompanyInfo || {};
  console.log('CompanyName:', c.CompanyName);
  console.log('CompanyStartDate:', c.CompanyStartDate);
  console.log('FiscalYearStartMonth:', c.FiscalYearStartMonth);
  console.log('Country:', c.Country);
  console.log('MetaData:', JSON.stringify(c.MetaData));

  // Preferences
  const prefs = await q("preferences?");
  console.log('\n=== Preferences (accounting + closing) ===');
  const p = prefs.body?.Preferences || {};
  console.log('AccountingInfoPrefs:', JSON.stringify(p.AccountingInfoPrefs, null, 2));
  console.log('\nEmployeeSavingsRetirementPrefs:', JSON.stringify(p.EmployeeSavingsRetirementPrefs, null, 2));
  console.log('\nReportPrefs:', JSON.stringify(p.ReportPrefs, null, 2));

  await prisma.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
