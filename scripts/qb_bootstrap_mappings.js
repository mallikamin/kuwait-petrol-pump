/**
 * QB Mapping Bootstrap
 *
 * Seeds the qb_entity_mappings rows required by the Phase 2-5 modules
 * (expenses, cash reconciliation, customer advances, PSO top-ups) by
 * looking up each target in QuickBooks by name and upserting the mapping.
 *
 * Runs INSIDE the backend container so it can require the compiled
 * dist/ paths and reuse the battle-tested token refresh + entity
 * mapping service (not the broken intuit-oauth SDK).
 *
 *   # dry-run (no DB writes)
 *   docker cp scripts/qb_bootstrap_mappings.js kuwaitpos-backend:/tmp/qbb.js
 *   docker exec kuwaitpos-backend node /tmp/qbb.js --dry-run
 *
 *   # live (writes qb_entity_mappings rows)
 *   docker exec kuwaitpos-backend node /tmp/qbb.js
 *
 *   # scope to a specific organization (default = first active QB conn)
 *   docker exec kuwaitpos-backend node /tmp/qbb.js --org=<uuid>
 *
 * Exit codes:
 *   0  all required mappings either created or already present
 *   2  at least one required QB entity is missing (admin must create in QB)
 *   1  fatal error (bad connection, token refresh failure, etc.)
 */

const https = require('https');
const { prisma } = require('/app/apps/backend/dist/config/database');
const { redis, connectRedis } = require('/app/apps/backend/dist/config/redis');
const { getValidAccessToken } = require('/app/apps/backend/dist/services/quickbooks/token-refresh');
const { EntityMappingService } = require('/app/apps/backend/dist/services/quickbooks/entity-mapping.service');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const orgArg = (argv.find((a) => a.startsWith('--org=')) || '').slice(6) || null;

/**
 * Required mappings resolved against live QB at bootstrap time.
 * `candidates` is ordered — first hit wins — so the admin can rename
 * accounts in QB without breaking the bootstrap as long as one variant
 * still resolves.
 *
 * `verifyOnly: true` entries are NOT auto-created; the bootstrap just
 * reports whether the mapping already exists (these must have been
 * seeded by an earlier sprint and represent a precondition).
 */
const REQUIRED = [
  {
    key: 'account/customer-advance',
    entityType: 'account',
    localId: 'customer-advance',
    qbEntity: 'Account',
    candidates: ['Customer Advances', 'Customer Advance', 'Customer Advance Liability'],
    description: 'Other Current Liability — unearned advance deposits per customer',
    // If not found, create it on --execute runs. Dry-run just reports.
    autoCreate: {
      AccountType: 'Other Current Liability',
      AccountSubType: 'OtherCurrentLiabilities',
      Name: 'Customer Advances',
      Description: 'Liability: cash/bank card/PSO card advances held on behalf of customers',
    },
  },
  {
    key: 'account/accounts-receivable',
    entityType: 'account',
    localId: 'accounts-receivable',
    qbEntity: 'Account',
    // QB realm uses "Receivables" as the A/R account name; "Trade Receivables"
    // is a sibling A/R account. Keep the spec names as fall-backs for other
    // realms.
    candidates: ['Receivables', 'Trade Receivables', 'Accounts Receivable', 'Accounts Receivable (A/R)', 'A/R'],
    description: 'A/R account (used for bank-card / pso-card receivable journal legs)',
  },
  {
    // Note: localId is 'trade-payables' (shared with purchase.handler) —
    // not 'accounts-payable' — so we reuse the existing mapping row in
    // realms where the purchase flow already seeded it. This realm uses
    // "Trade Payables" for A/P.
    key: 'account/trade-payables',
    entityType: 'account',
    localId: 'trade-payables',
    qbEntity: 'Account',
    candidates: ['Trade Payables', 'Accounts Payable', 'Accounts Payable (A/P)', 'A/P'],
    description: 'A/P account — shared by purchase.handler + pso-topup.handler',
  },
  // Intentionally NOT bootstrapping a 'vendor/pso-vendor' alias.
  // pso-topup.handler resolves PSO via qbName directly (the canonical
  // vendor mapping is stored under the supplier UUID by purchase.handler,
  // and the UNIQUE(org, entity_type, qb_id) constraint blocks a second
  // alias row pointing at the same QB vendor).
  {
    key: 'customer/bank-card-receivable',
    entityType: 'customer',
    localId: 'bank-card-receivable',
    qbEntity: 'Customer',
    candidates: ['Bank Card Receivable', 'Bank Card Receivables', 'Bank Card Receiveable'],
    description: 'Sub-customer holding bank-card AR (S4-S6 flow + advance deposits)',
  },
  {
    key: 'customer/pso-card-receivable',
    entityType: 'customer',
    localId: 'pso-card-receivable',
    qbEntity: 'Customer',
    candidates: ['PSO Card Receivable', 'PSO Card Receivables'],
    description: 'Sub-customer holding PSO-card AR (S7 flow + advance deposits)',
  },
  {
    key: 'bank_account/cash',
    entityType: 'bank_account',
    localId: 'cash',
    qbEntity: 'Account',
    candidates: ['Cash in Hand', 'Cash on Hand', 'Cash'],
    description: 'Cash in Hand — physical drawer (precondition, seeded by prior sprint)',
    verifyOnly: true,
  },
];

function escName(n) {
  return String(n).replace(/'/g, "\\'");
}

// Label → actual QB account name mapping for expense accounts. The seed
// migration wrote "Admin Expenses:<subname>" into qb_account_name, but in
// this QB realm the expense accounts are flat (not nested under an
// "Admin Expenses" parent), so the cash-expense QB handler fails to
// resolve them by the migrated name. This table is used to rewrite the
// qb_account_name column to the real QB name so sync-time lookup works.
// Verified against the QuickBooks Entities snapshot + live query.
const EXPENSE_ACCOUNT_NAME_FIX = {
  'Cleaning Expense':               'Cleaning Expense',
  'Electricity Expense':            'Electricity expenses',
  'Entertainment Expense':          'Entertainment Expenses',
  'General Maintenance':            'General maintenance',
  'Generator Expense':              'Generator Expense',
  'Legal Expense':                  'Legal expenses',
  'Motor Bike Petrol':              'Motor Bike Petrol',
  'PTCL Bill':                      'PTCL Bill',
  'Repair & Maintenance':           'Repair & Maintainance expense',
  'Service Station Operating Exp.': 'Service Station Operating exp',
  'Staff Accommodation':            'Staff Accomodation',
  'Staff Food':                     'Staff Food',
  'Stationery':                     'Stationery Expenses',
  'Telephone':                      'Telephone Expense',
  'Advertisement':                  'Advertisement expense',
  'Staff Payroll':                  'Staff payroll',
  'Miscellaneous':                  'Miscellaneous Expenses',
};

function qbPost(realmId, accessToken, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'quickbooks.api.intuit.com',
        path: `/v3/company/${realmId}/${path}?minorversion=65`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
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
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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
            try {
              resolve({ status: res.statusCode, body: JSON.parse(b) });
            } catch {
              resolve({ status: res.statusCode, body: b });
            }
          });
        },
      )
      .on('error', reject)
      .end();
  });
}

async function findByName(realmId, accessToken, qbEntity, candidates) {
  for (const name of candidates) {
    const r = await qbQuery(
      realmId,
      accessToken,
      `SELECT Id, Name FROM ${qbEntity} WHERE Name = '${escName(name)}'`,
    );
    const rows = (r.body && r.body.QueryResponse && r.body.QueryResponse[qbEntity]) || [];
    if (rows.length > 0) return { match: rows[0], usedName: name, matchedOn: 'Name' };
  }
  // Customer / Vendor use DisplayName as their canonical display label.
  if (qbEntity === 'Customer' || qbEntity === 'Vendor') {
    for (const name of candidates) {
      const r = await qbQuery(
        realmId,
        accessToken,
        `SELECT Id, DisplayName FROM ${qbEntity} WHERE DisplayName = '${escName(name)}'`,
      );
      const rows = (r.body && r.body.QueryResponse && r.body.QueryResponse[qbEntity]) || [];
      if (rows.length > 0) return { match: rows[0], usedName: name, matchedOn: 'DisplayName' };
    }
  }
  return null;
}

(async () => {
  const mode = dryRun ? 'DRY-RUN (no DB writes)' : 'LIVE';
  console.log(`== QB Bootstrap Mappings == [${mode}]`);

  // Token refresh uses a Redis single-flight lock; the shared redis client is
  // lazy-created but not auto-connected by the backend's bootstrap in a
  // one-shot script context. Open it explicitly here so acquireRefreshLock
  // doesn't trip on ClientClosedError.
  await connectRedis();

  const conn = await prisma.qBConnection.findFirst({
    where: { isActive: true, ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { id: true, organizationId: true, realmId: true },
  });
  if (!conn) {
    console.error(`ERR: no active QB connection${orgArg ? ` for org ${orgArg}` : ''}`);
    process.exit(1);
  }
  const { organizationId, realmId } = conn;
  console.log(`Organization: ${organizationId}`);
  console.log(`Realm:        ${realmId}`);
  console.log('');

  // getValidAccessToken accepts (orgId) or (orgId, prismaClient); use the
  // simpler arity matching scripts/qb_verify_pso_test.js.
  const tok = await getValidAccessToken(organizationId);
  const accessToken = tok.accessToken;

  const summary = {
    created: [],
    alreadyMapped: [],
    missingInQb: [],
    verifyOnlyOk: [],
    verifyOnlyMissing: [],
  };

  console.log('-- Required mappings --');
  for (const spec of REQUIRED) {
    const existing = await EntityMappingService.getQbId(
      organizationId,
      spec.entityType,
      spec.localId,
    );
    if (existing) {
      console.log(`  OK   ${spec.key.padEnd(36)} qbId=${existing}  (already mapped)`);
      summary.alreadyMapped.push({ key: spec.key, qbId: existing });
      if (spec.verifyOnly) summary.verifyOnlyOk.push(spec.key);
      continue;
    }
    if (spec.verifyOnly) {
      console.log(`  MISS ${spec.key.padEnd(36)} (verify-only precondition — seed manually)`);
      summary.verifyOnlyMissing.push(spec.key);
      continue;
    }
    let hit = await findByName(realmId, accessToken, spec.qbEntity, spec.candidates);
    if (!hit && spec.autoCreate) {
      if (dryRun) {
        console.log(
          `  MISS ${spec.key.padEnd(36)} (would auto-create in QB: "${spec.autoCreate.Name}")`,
        );
        summary.missingInQb.push({ key: spec.key, tried: spec.candidates, qbEntity: spec.qbEntity, autoCreate: spec.autoCreate.Name });
        continue;
      }
      // Live: POST to QB to create the account, then treat as hit.
      const created = await qbPost(realmId, accessToken, 'account', spec.autoCreate);
      if (created.status >= 300 || !(created.body && created.body.Account)) {
        console.log(`  FAIL ${spec.key.padEnd(36)} auto-create failed:`, JSON.stringify(created.body).slice(0, 200));
        summary.missingInQb.push({ key: spec.key, tried: spec.candidates, qbEntity: spec.qbEntity, autoCreateFailed: true });
        continue;
      }
      hit = { match: created.body.Account, usedName: spec.autoCreate.Name, matchedOn: 'auto-created' };
      console.log(`  CREATED in QB: "${spec.autoCreate.Name}" qbId=${hit.match.Id}`);
    }
    if (!hit) {
      console.log(
        `  MISS ${spec.key.padEnd(36)} not found in QB — tried: ${spec.candidates.join(' | ')}`,
      );
      summary.missingInQb.push({ key: spec.key, tried: spec.candidates, qbEntity: spec.qbEntity });
      continue;
    }
    const qbId = hit.match.Id;
    const qbName = hit.match.Name || hit.match.DisplayName || hit.usedName;
    if (dryRun) {
      console.log(
        `  WOULD ${spec.key.padEnd(35)} -> qbId=${qbId}  (${qbName}, matched on ${hit.matchedOn})`,
      );
      summary.created.push({ key: spec.key, qbId, qbName, dryRun: true });
    } else {
      await EntityMappingService.upsertMapping(
        organizationId,
        spec.entityType,
        spec.localId,
        qbId,
        qbName,
      );
      console.log(`  NEW  ${spec.key.padEnd(36)} -> qbId=${qbId}  (${qbName})`);
      summary.created.push({ key: spec.key, qbId, qbName });
    }
  }

  // --- Repair expense_accounts.qb_account_name (align to actual QB names).
  // The seed migration prefixed every name with "Admin Expenses:" but in
  // this realm the expense accounts are flat, so the cash-expense QB
  // handler fails to resolve any of them at sync time. Rewrite per the
  // verified label → QB-name map.
  console.log('\n-- Expense account name repair --');
  const toRepair = await prisma.expenseAccount.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, label: true, qbAccountName: true },
    orderBy: { sortOrder: 'asc' },
  });
  const repairSummary = { updated: [], skipped: [] };
  for (const ea of toRepair) {
    const target = EXPENSE_ACCOUNT_NAME_FIX[ea.label];
    if (!target) {
      console.log(`  SKIP ${ea.label.padEnd(32)} (no repair mapping; leaving "${ea.qbAccountName}")`);
      repairSummary.skipped.push(ea.label);
      continue;
    }
    if (ea.qbAccountName === target) {
      console.log(`  OK   ${ea.label.padEnd(32)} already "${target}"`);
      continue;
    }
    if (dryRun) {
      console.log(`  WOULD ${ea.label.padEnd(31)} "${ea.qbAccountName}" -> "${target}"`);
      repairSummary.updated.push({ label: ea.label, from: ea.qbAccountName, to: target, dryRun: true });
    } else {
      await prisma.expenseAccount.update({
        where: { id: ea.id },
        data: { qbAccountName: target },
      });
      console.log(`  FIX  ${ea.label.padEnd(32)} "${ea.qbAccountName}" -> "${target}"`);
      repairSummary.updated.push({ label: ea.label, from: ea.qbAccountName, to: target });
    }
  }

  // --- Verify expense accounts (lookup-by-name at post time, no mapping row needed)
  console.log('\n-- Expense accounts verification --');
  const expenseAccounts = await prisma.expenseAccount.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, label: true, qbAccountName: true },
    orderBy: { sortOrder: 'asc' },
  });
  const expSummary = { found: [], missing: [], noQbName: [] };
  for (const ea of expenseAccounts) {
    if (!ea.qbAccountName) {
      console.log(`  SKIP ${ea.label.padEnd(32)} (no qbAccountName on local row)`);
      expSummary.noQbName.push(ea.label);
      continue;
    }
    const r = await qbQuery(
      realmId,
      accessToken,
      `SELECT Id, Name FROM Account WHERE Name = '${escName(ea.qbAccountName)}'`,
    );
    const hit = r.body && r.body.QueryResponse && r.body.QueryResponse.Account && r.body.QueryResponse.Account[0];
    if (hit) {
      console.log(`  OK   ${ea.label.padEnd(32)} -> "${ea.qbAccountName}"  qbId=${hit.Id}`);
      expSummary.found.push({ label: ea.label, qbName: ea.qbAccountName, qbId: hit.Id });
    } else {
      console.log(`  MISS ${ea.label.padEnd(32)} -> "${ea.qbAccountName}"  NOT FOUND IN QB`);
      expSummary.missing.push({ label: ea.label, qbName: ea.qbAccountName });
    }
  }

  console.log('\n==== SUMMARY ====');
  console.log(`Mode:                  ${mode}`);
  console.log(`Mappings created:      ${summary.created.length}`);
  console.log(`Mappings already set:  ${summary.alreadyMapped.length}`);
  console.log(`Mappings missing:      ${summary.missingInQb.length}`);
  if (summary.verifyOnlyMissing.length) {
    console.log(`Verify-only MISSING:   ${summary.verifyOnlyMissing.join(', ')}`);
  }
  console.log(
    `Expense accounts:      ${expSummary.found.length}/${expenseAccounts.length} verified` +
      (expSummary.missing.length ? `, ${expSummary.missing.length} missing` : '') +
      (expSummary.noQbName.length ? `, ${expSummary.noQbName.length} without qbAccountName` : ''),
  );

  if (summary.missingInQb.length || expSummary.missing.length) {
    console.log('\n>>> ACTION REQUIRED in QuickBooks before rerun <<<');
    for (const m of summary.missingInQb) {
      console.log(
        `  - Create ${m.qbEntity} matching one of: ${m.tried.map((c) => `"${c}"`).join(' | ')}`,
      );
    }
    for (const m of expSummary.missing) {
      console.log(`  - Create Account named: "${m.qbName}"  (for expense "${m.label}")`);
    }
  }

  const jsonSummary = {
    mode: dryRun ? 'DRY_RUN' : 'LIVE',
    organizationId,
    realmId,
    mappings: summary,
    expenseAccounts: expSummary,
    totals: {
      mappingsCreated: summary.created.length,
      mappingsAlreadyPresent: summary.alreadyMapped.length,
      mappingsMissingInQb: summary.missingInQb.length,
      verifyOnlyMissing: summary.verifyOnlyMissing.length,
      expenseAccountsVerified: expSummary.found.length,
      expenseAccountsMissing: expSummary.missing.length,
    },
  };
  console.log('\n---JSON-SUMMARY---');
  console.log(JSON.stringify(jsonSummary, null, 2));
  console.log('---END-JSON-SUMMARY---');

  await prisma.$disconnect();
  try { await redis.quit(); } catch {}
  const hasBlockers =
    summary.missingInQb.length > 0 ||
    summary.verifyOnlyMissing.length > 0 ||
    expSummary.missing.length > 0;
  process.exit(hasBlockers ? 2 : 0);
})().catch((e) => {
  console.error('FATAL:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack);
  process.exit(1);
});
