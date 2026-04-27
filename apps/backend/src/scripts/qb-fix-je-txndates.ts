/**
 * One-shot fix: align previously-posted dip-variance JournalEntry TxnDates
 * with the source row's business_date.
 *
 * Why this exists:
 *   The S11 handler used to hard-code TxnDate = `${monthLabel}-01`, so a
 *   gain/loss row entered on 2026-03-15 posted to QB dated 2026-03-01. The
 *   handler is fixed going forward to use businessDate, but the JEs already
 *   in QB still have the wrong TxnDate. This script walks the audit log,
 *   finds every successful CREATE_JOURNAL_ENTRY whose TxnDate doesn't match
 *   its source row's business_date, and POSTs an `update` to QB to correct
 *   it.
 *
 * Approach:
 *   1. Load every monthly_inventory_gain_loss row (id, business_date).
 *   2. Pull the most-recent SUCCESS audit log entry per row → QB JE Id.
 *   3. For each, GET the JE from QB (need the SyncToken for update).
 *   4. If TxnDate already matches business_date → skip (idempotent).
 *   5. Otherwise POST update with corrected TxnDate.
 *
 * Usage (against the prod backend container):
 *   docker exec -w /app/apps/backend kuwaitpos-backend \
 *     node dist/scripts/qb-fix-je-txndates.js --org kpc
 *
 *   docker exec -w /app/apps/backend kuwaitpos-backend \
 *     node dist/scripts/qb-fix-je-txndates.js --org kpc --apply
 *
 * Idempotent: re-runs are no-ops once dates match.
 */

import * as https from 'https';
import { prisma } from '../config/database';
import { decryptToken } from '../services/quickbooks/encryption';

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

async function refreshAccessTokenViaHttp(refreshToken: string): Promise<string> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET not set');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const res = await httpsRequest(
    {
      hostname: 'oauth.platform.intuit.com',
      path: '/oauth2/v1/tokens/bearer',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
    },
    body,
  );
  if (res.status !== 200) {
    throw new Error(`QB token refresh failed ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body).access_token as string;
}

async function getFreshAccessToken(connection: { refreshTokenEncrypted: string }): Promise<string> {
  return refreshAccessTokenViaHttp(decryptToken(connection.refreshTokenEncrypted));
}

interface Plan {
  glId: string;
  businessDate: string; // YYYY-MM-DD
  qbJeId: string;
  currentTxnDate?: string;
  syncToken?: string;
  action: 'update' | 'skip-already-correct' | 'skip-no-je' | 'skip-not-found';
  reason?: string;
}

function qbApiHost(): string {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'quickbooks.api.intuit.com'
    : 'sandbox-quickbooks.api.intuit.com';
}

function httpsRequest(opts: https.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJournalEntry(realmId: string, accessToken: string, qbId: string): Promise<any | null> {
  const res = await httpsRequest({
    hostname: qbApiHost(),
    path: `/v3/company/${realmId}/journalentry/${qbId}?minorversion=65`,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GET JE ${qbId} failed ${res.status}: ${res.body}`);
  const data = JSON.parse(res.body);
  return data.JournalEntry;
}

async function updateJournalEntry(
  realmId: string,
  accessToken: string,
  je: any,
  newTxnDate: string,
): Promise<void> {
  const updated = { ...je, TxnDate: newTxnDate };
  // QB sparse-update flag — but we keep the full payload to be safe; QB
  // requires Id + SyncToken regardless.
  const body = JSON.stringify({ ...updated, sparse: true });
  const res = await httpsRequest(
    {
      hostname: qbApiHost(),
      path: `/v3/company/${realmId}/journalentry?operation=update&minorversion=65`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
    },
    body,
  );
  if (res.status !== 200) throw new Error(`UPDATE JE ${je.Id} failed ${res.status}: ${res.body}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const orgCode = parseFlag(args, 'org');
  const apply = hasFlag(args, 'apply');
  if (!orgCode) {
    console.error('Usage: qb-fix-je-txndates --org <code> [--apply]');
    process.exit(2);
  }

  const org = await prisma.organization.findFirst({ where: { code: orgCode } });
  if (!org) {
    console.error(`Organization not found by code "${orgCode}"`);
    process.exit(2);
  }
  const conn = await prisma.qBConnection.findFirst({
    where: { organizationId: org.id, isActive: true },
  });
  if (!conn) {
    console.error(`No active QB connection for org "${orgCode}"`);
    process.exit(2);
  }

  console.log(`[fix-txndates] org=${orgCode} realm=${conn.realmId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  // 1. all G/L rows
  const gls = await prisma.monthlyInventoryGainLoss.findMany({
    where: { organizationId: org.id },
    select: { id: true, businessDate: true },
    orderBy: { businessDate: 'asc' },
  });

  // 2. most-recent SUCCESS audit log per row → QB JE Id
  const audits = await prisma.$queryRawUnsafe<{ entity_id: string; qb_id: string; max_created: Date }[]>(
    `SELECT entity_id::text,
            (response_payload->>'Id') AS qb_id,
            MAX(created_at) AS max_created
       FROM quickbooks_audit_log
      WHERE entity_type='inventory_adjustment'
        AND operation='CREATE_JOURNAL_ENTRY'
        AND status='SUCCESS'
        AND response_payload->>'Id' IS NOT NULL
   GROUP BY entity_id, response_payload->>'Id'`,
  );
  // Multiple posts per entity are possible (e.g. dry-run + real). Keep the most recent.
  const latestByEntity: Record<string, { qbId: string; created: Date }> = {};
  for (const a of audits) {
    const cur = latestByEntity[a.entity_id];
    if (!cur || a.max_created > cur.created) {
      latestByEntity[a.entity_id] = { qbId: a.qb_id, created: a.max_created };
    }
  }

  const accessToken = await getFreshAccessToken(conn);
  const plans: Plan[] = [];

  for (const gl of gls) {
    const target = gl.businessDate.toISOString().slice(0, 10);
    const audit = latestByEntity[gl.id];
    if (!audit) {
      plans.push({ glId: gl.id, businessDate: target, qbJeId: '', action: 'skip-no-je', reason: 'no SUCCESS audit log entry' });
      continue;
    }
    const je = await getJournalEntry(conn.realmId, accessToken, audit.qbId);
    if (!je) {
      plans.push({ glId: gl.id, businessDate: target, qbJeId: audit.qbId, action: 'skip-not-found', reason: 'JE not found in QB (deleted?)' });
      continue;
    }
    if (je.TxnDate === target) {
      plans.push({ glId: gl.id, businessDate: target, qbJeId: audit.qbId, currentTxnDate: je.TxnDate, syncToken: je.SyncToken, action: 'skip-already-correct' });
      continue;
    }
    plans.push({ glId: gl.id, businessDate: target, qbJeId: audit.qbId, currentTxnDate: je.TxnDate, syncToken: je.SyncToken, action: 'update', reason: `${je.TxnDate} -> ${target}` });
  }

  // Report
  console.log(`\n=== Plan (${plans.length} G/L rows) ===\n`);
  for (const p of plans) {
    const tag = {
      'update': '🔧 UPDATE',
      'skip-already-correct': '✅ OK    ',
      'skip-no-je': '⚠️  no JE',
      'skip-not-found': '⚠️  404  ',
    }[p.action];
    console.log(`  ${tag}  gl=${p.glId.slice(0,8)}…  je=${p.qbJeId.padEnd(8)}  target=${p.businessDate}  ${p.reason || ''}`);
  }

  const updates = plans.filter((p) => p.action === 'update');
  console.log(`\nUpdates needed: ${updates.length}`);

  if (!apply) {
    console.log(`(dry-run; pass --apply to push updates to QB)`);
    await prisma.$disconnect();
    process.exit(0);
  }

  if (updates.length === 0) {
    console.log('Nothing to update.');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`\n=== Applying ${updates.length} update(s) ===`);
  let ok = 0;
  let failed = 0;
  for (const p of updates) {
    try {
      const je = await getJournalEntry(conn.realmId, accessToken, p.qbJeId);
      if (!je) { failed++; console.log(`  ❌ ${p.qbJeId}: gone (404)`); continue; }
      await updateJournalEntry(conn.realmId, accessToken, je, p.businessDate);
      ok++;
      console.log(`  ✅ JE=${p.qbJeId} TxnDate -> ${p.businessDate}`);
    } catch (err: any) {
      failed++;
      console.log(`  ❌ JE=${p.qbJeId}: ${err?.message || err}`);
    }
  }
  console.log(`\nDone. ok=${ok} failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[qb-fix-je-txndates] FATAL:', err);
  await prisma.$disconnect();
  process.exit(2);
});
