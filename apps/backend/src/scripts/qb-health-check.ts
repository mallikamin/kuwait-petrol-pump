/**
 * QB Sync Health Check — daily diagnostic, designed for cron.
 *
 * What it inspects (per active QB connection):
 *   1. dead_letter jobs in qb_sync_queue (any -> alert)
 *   2. failed jobs created in last 24h (any -> alert)
 *   3. pending/processing jobs older than --stuck-threshold-min (default 30)
 *   4. refresh_token expiry < --token-warn-days (default 14)
 *   5. stale qb_entity_mappings (qb_id missing or Active=false in QB live COA)
 *   6. monthly_inventory_gain_loss rows with NO successful CREATE_JOURNAL_ENTRY
 *      audit log entry (catches the dry-run-as-completed trap we just hit)
 *
 * Exits 0 when healthy, 1 when any check fails. Optional Slack/Discord-style
 * webhook via QB_ALERT_WEBHOOK_URL.
 *
 * Usage (from container after build):
 *   node /app/apps/backend/dist/scripts/qb-health-check.js
 *   node /app/apps/backend/dist/scripts/qb-health-check.js --json
 *   node /app/apps/backend/dist/scripts/qb-health-check.js --token-warn-days 30
 *   node /app/apps/backend/dist/scripts/qb-health-check.js --skip-coa     (skips live QB query)
 *
 * Recommended cron (host crontab; runs once a day at 06:00 UTC):
 *   0 6 * * * /opt/kuwaitpos/scripts/cron-qb-health.sh
 */

import { prisma } from '../config/database';
import { getFreshAccessToken, qbListAll, postWebhookAlert, parseFlag, hasFlag } from './qb-script-helpers';

interface OrgFinding {
  orgId: string;
  orgName: string;
  realmId: string;
  issues: string[];
}

interface HealthReport {
  timestamp: string;
  healthy: boolean;
  orgs: OrgFinding[];
  summary: string[];
}

async function checkOrg(opts: {
  orgId: string;
  orgName: string;
  stuckMinutes: number;
  tokenWarnDays: number;
  skipCoa: boolean;
}): Promise<OrgFinding> {
  const { orgId, orgName, stuckMinutes, tokenWarnDays, skipCoa } = opts;
  const finding: OrgFinding = { orgId, orgName, realmId: '', issues: [] };

  const conn = await prisma.qBConnection.findFirst({
    where: { organizationId: orgId, isActive: true },
  });
  if (!conn) {
    finding.issues.push('No active QB connection — skipped (info)');
    return finding;
  }
  finding.realmId = conn.realmId;

  // 1. dead_letter jobs
  const deadLetters = await prisma.qBSyncQueue.groupBy({
    by: ['entityType', 'jobType'],
    where: { organizationId: orgId, status: 'dead_letter' },
    _count: { _all: true },
  });
  for (const dl of deadLetters) {
    finding.issues.push(`dead_letter: ${dl._count._all} × ${dl.entityType}/${dl.jobType}`);
  }

  // 2. recent failures (last 24h)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failedRecent = await prisma.qBSyncQueue.count({
    where: { organizationId: orgId, status: 'failed', createdAt: { gte: since24h } },
  });
  if (failedRecent > 0) {
    finding.issues.push(`${failedRecent} failed jobs in last 24h (between retries; will dead-letter if not recovered)`);
  }

  // 3. stuck pending/processing
  const stuckCutoff = new Date(Date.now() - stuckMinutes * 60 * 1000);
  const stuck = await prisma.qBSyncQueue.count({
    where: {
      organizationId: orgId,
      status: { in: ['pending', 'processing'] },
      createdAt: { lt: stuckCutoff },
    },
  });
  if (stuck > 0) {
    finding.issues.push(`${stuck} job(s) stuck in pending/processing for >${stuckMinutes}min — worker may be wedged`);
  }

  // 4. refresh token expiry
  if (conn.refreshTokenExpiresAt) {
    const daysLeft = Math.floor((conn.refreshTokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
      finding.issues.push(`refresh token EXPIRED ${-daysLeft} days ago — re-auth required immediately`);
    } else if (daysLeft < tokenWarnDays) {
      finding.issues.push(`refresh token expires in ${daysLeft} days (warn-threshold ${tokenWarnDays}d)`);
    }
  }

  // 5. stale mappings — needs a QB API call. Skipped via --skip-coa.
  if (!skipCoa) {
    try {
      const mappings = await prisma.qBEntityMapping.findMany({
        where: { organizationId: orgId, isActive: true },
      });
      const accessToken = await getFreshAccessToken(conn);
      const cache: Record<string, Map<string, any>> = {};
      const qbTypeFor = (t: string): string | null =>
        ({ account: 'Account', bank_account: 'Account', customer: 'Customer', vendor: 'Vendor', item: 'Item', payment_method: 'PaymentMethod' } as any)[t] || null;
      for (const m of mappings) {
        const qbType = qbTypeFor(m.entityType);
        if (!qbType) continue;
        if (!cache[qbType]) {
          const all = await qbListAll(conn.realmId, accessToken, qbType, { includeInactive: true });
          cache[qbType] = new Map(all.map((r: any) => [String(r.Id), r]));
        }
        const live = cache[qbType].get(m.qbId);
        if (!live) {
          finding.issues.push(
            `stale mapping: ${m.entityType}/${m.localId} → qb_id=${m.qbId} not present in QB`,
          );
        } else if (live.Active === false) {
          finding.issues.push(
            `inactive mapping: ${m.entityType}/${m.localId} → qb_id=${m.qbId} ("${live.Name || live.DisplayName}") is INACTIVE in QB`,
          );
        }
      }
    } catch (err: any) {
      finding.issues.push(`COA check failed: ${err?.message || err}`);
    }
  }

  // 6. G/L rows that never posted to QB. Compares monthly_inventory_gain_loss
  // against quickbooks_audit_log SUCCESS/CREATE_JOURNAL_ENTRY entries
  // (skipping DRY_RUN). This caught the qty=1 HSD entry on 2026-04-27.
  const allGl = await prisma.monthlyInventoryGainLoss.findMany({
    where: { organizationId: orgId },
    select: { id: true, businessDate: true, fuelType: { select: { code: true } } },
  });
  if (allGl.length > 0) {
    const ids = allGl.map((r) => r.id);
    const successRows = await prisma.$queryRawUnsafe<{ entity_id: string }[]>(
      `SELECT DISTINCT entity_id::text FROM quickbooks_audit_log
        WHERE entity_type = 'inventory_adjustment'
          AND operation  = 'CREATE_JOURNAL_ENTRY'
          AND status     = 'SUCCESS'
          AND entity_id  = ANY($1::uuid[])`,
      ids,
    );
    const posted = new Set(successRows.map((r) => r.entity_id));
    const missing = allGl.filter((r) => !posted.has(r.id));
    if (missing.length > 0) {
      const sample = missing
        .slice(0, 5)
        .map((r) => `${r.businessDate.toISOString().slice(0, 10)} ${r.fuelType.code}`)
        .join(', ');
      finding.issues.push(
        `${missing.length} gain/loss row(s) have NO QB JE posted (sample: ${sample}${missing.length > 5 ? ', …' : ''})`,
      );
    }
  }

  return finding;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const stuckMinutes = parseInt(parseFlag(args, 'stuck-threshold-min') || '30', 10);
  const tokenWarnDays = parseInt(parseFlag(args, 'token-warn-days') || '14', 10);
  const skipCoa = hasFlag(args, 'skip-coa');
  const jsonMode = hasFlag(args, 'json');

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const findings: OrgFinding[] = [];
  for (const org of orgs) {
    findings.push(await checkOrg({
      orgId: org.id, orgName: org.name,
      stuckMinutes, tokenWarnDays, skipCoa,
    }));
  }

  const orgsWithIssues = findings.filter((f) => f.issues.length > 0);
  // The "no QB connection" message is informational, not a failure.
  const orgsWithRealIssues = orgsWithIssues.filter(
    (f) => !(f.issues.length === 1 && f.issues[0].startsWith('No active QB connection')),
  );
  const healthy = orgsWithRealIssues.length === 0;

  const summary: string[] = [];
  summary.push(`Checked ${orgs.length} org(s); ${orgsWithRealIssues.length} with issues; ${skipCoa ? 'COA check SKIPPED' : 'COA check ON'}`);
  for (const f of findings) {
    if (f.issues.length === 0) {
      summary.push(`✅ [${f.orgName}] no issues`);
    } else {
      summary.push(`❌ [${f.orgName}] (realm=${f.realmId || 'n/a'})`);
      for (const i of f.issues) summary.push(`     - ${i}`);
    }
  }

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    healthy,
    orgs: findings,
    summary,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[QB Health Check] ${report.timestamp}`);
    for (const line of summary) console.log(line);
  }

  if (!healthy) {
    const alertLines = [
      `🚨 *QB Sync Health Check — failures detected* (${report.timestamp})`,
      ...summary,
    ];
    await postWebhookAlert(alertLines.join('\n'));
  }

  await prisma.$disconnect();
  process.exit(healthy ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[qb-health-check] FATAL:', err);
  await postWebhookAlert(`🚨 QB health check CRASHED: ${err?.message || err}`);
  await prisma.$disconnect();
  process.exit(2);
});
