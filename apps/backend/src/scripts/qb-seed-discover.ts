/**
 * QB Mapping Discovery + Seed — manifest-driven, per-org.
 *
 * Replaces the static `scripts/qb-mapping-seed.sql` for new tenants.
 * Walks the canonical manifest (apps/backend/src/scripts/qb-mapping-manifest.ts),
 * resolves each entry to a live QB entity in the target org's realm,
 * and upserts qb_entity_mappings rows. Then the dynamic descriptors
 * (per-row mappings: fuel_types → Item, banks → Account, credit
 * customers → Customer) are walked the same way.
 *
 * Usage (against a running container):
 *   # Dry-run plan against kpc:
 *   docker exec -w /app/apps/backend kuwaitpos-backend \
 *     node dist/scripts/qb-seed-discover.js --org kpc
 *
 *   # Apply for SE after their QB connect step:
 *   docker exec -w /app/apps/backend kuwaitpos-backend \
 *     node dist/scripts/qb-seed-discover.js --org se --apply
 *
 * Idempotent. Safe to re-run; existing mappings are upserted by
 * (organization_id, entity_type, local_id).
 *
 * Exit codes:
 *   0  every required mapping resolved (and applied if --apply)
 *   1  one or more mappings unresolved — operator must add them by
 *      hand, or extend the manifest's namePatterns
 */

import { prisma } from '../config/database';
import {
  STATIC_MANIFEST,
  StaticManifestEntry,
  ManifestEntityType,
} from './qb-mapping-manifest';
import {
  getFreshAccessToken,
  qbListAll,
  parseFlag,
  hasFlag,
} from './qb-script-helpers';

interface ResolveResult {
  entry: StaticManifestEntry | { entityType: ManifestEntityType; localId: string; qbEntity: string; namePatterns: string[]; sourceLabel: string };
  match: { id: string; name: string; active: boolean } | null;
  candidates: { id: string; name: string; active: boolean }[];
  reason?: string;
}

function nameOf(row: any): string {
  return String(row.DisplayName || row.Name || '').trim();
}

function activeOf(row: any): boolean {
  // Customer/Vendor → Active boolean. Account/Item → Active boolean. PaymentMethod → Active boolean.
  return row.Active !== false;
}

function pickByPatterns(rows: any[], patterns: string[]): { match: any | null; candidates: any[] } {
  // Try each pattern in order; first pattern that yields exactly one ACTIVE
  // hit wins. If a pattern returns >1 active hits, skip to the next pattern;
  // a more-specific pattern usually disambiguates.
  for (const pattern of patterns) {
    const lc = pattern.toLowerCase();
    const hits = rows.filter((r) => nameOf(r).toLowerCase().includes(lc));
    const active = hits.filter(activeOf);
    if (active.length === 1) return { match: active[0], candidates: hits };
    if (active.length === 0 && hits.length === 1) {
      // single inactive match — surface as candidate (operator decides)
      return { match: null, candidates: hits };
    }
  }
  return { match: null, candidates: [] };
}

async function resolveStatic(
  realmId: string,
  accessToken: string,
  entry: StaticManifestEntry,
): Promise<ResolveResult> {
  const cacheKey = entry.qbEntity;
  const all = await qbListAll(realmId, accessToken, cacheKey, { includeInactive: true });

  let pool = all;
  if (entry.accountTypeFilter && entry.qbEntity === 'Account') {
    pool = pool.filter((r) => r.AccountType === entry.accountTypeFilter);
  }

  const { match, candidates } = pickByPatterns(pool, entry.namePatterns);
  return {
    entry,
    match: match ? { id: String(match.Id), name: nameOf(match), active: activeOf(match) } : null,
    candidates: candidates.map((c) => ({ id: String(c.Id), name: nameOf(c), active: activeOf(c) })),
    reason: match ? undefined : (candidates.length === 0 ? 'no name-pattern match' : 'ambiguous or inactive only'),
  };
}

async function upsertMapping(orgId: string, entityType: string, localId: string, qbId: string, qbName: string): Promise<void> {
  await prisma.qBEntityMapping.upsert({
    where: { uq_qb_mapping_org_type_local: { organizationId: orgId, entityType, localId } },
    update: { qbId, qbName, isActive: true, updatedAt: new Date() },
    create: { organizationId: orgId, entityType, localId, localName: localId, qbId, qbName, isActive: true },
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const orgCode = parseFlag(args, 'org');
  const apply = hasFlag(args, 'apply');
  if (!orgCode) {
    console.error('Usage: qb-seed-discover --org <code> [--apply]');
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
    console.error(`No active QB connection for org "${orgCode}". Connect QB first.`);
    process.exit(2);
  }

  console.log(`[discover] org="${org.name}" code=${orgCode} realmId=${conn.realmId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  const accessToken = await getFreshAccessToken(conn);

  const results: ResolveResult[] = [];
  let resolved = 0;
  let unresolved = 0;

  // ── Static mappings ────────────────────────────────────────────────────
  for (const entry of STATIC_MANIFEST) {
    const r = await resolveStatic(conn.realmId, accessToken, entry);
    results.push(r);
    if (r.match) resolved++;
    else unresolved++;
  }

  // ── Dynamic: fuel items ───────────────────────────────────────────────
  const fuelTypes = await prisma.fuelType.findMany();
  const itemRows = await qbListAll(conn.realmId, accessToken, 'Item', { includeInactive: false });
  for (const ft of fuelTypes) {
    const patterns = [ft.code, ft.name].filter(Boolean) as string[];
    const { match, candidates } = pickByPatterns(itemRows, patterns);
    const r: ResolveResult = {
      entry: { entityType: 'item' as any, localId: ft.id, qbEntity: 'Item', namePatterns: patterns, sourceLabel: `fuel_types(${ft.code})` },
      match: match ? { id: String(match.Id), name: nameOf(match), active: activeOf(match) } : null,
      candidates: candidates.map((c) => ({ id: String(c.Id), name: nameOf(c), active: activeOf(c) })),
      reason: match ? undefined : 'no fuel item match',
    };
    results.push(r);
    if (r.match) resolved++;
    else unresolved++;
  }

  // ── Dynamic: banks (org-scoped) ──────────────────────────────────────
  const banks = await prisma.bank.findMany({ where: { organizationId: org.id } });
  const bankAccounts = (await qbListAll(conn.realmId, accessToken, 'Account', { includeInactive: false })).filter(
    (a: any) => a.AccountType === 'Bank',
  );
  for (const b of banks) {
    const { match, candidates } = pickByPatterns(bankAccounts, [b.name]);
    const r: ResolveResult = {
      entry: { entityType: 'bank_account', localId: b.id, qbEntity: 'Account', namePatterns: [b.name], sourceLabel: `banks(${b.name})` },
      match: match ? { id: String(match.Id), name: nameOf(match), active: activeOf(match) } : null,
      candidates: candidates.map((c) => ({ id: String(c.Id), name: nameOf(c), active: activeOf(c) })),
      reason: match ? undefined : 'no bank account match — create in QB or extend manifest',
    };
    results.push(r);
    if (r.match) resolved++;
    else unresolved++;
  }

  // ── Dynamic: credit customers ──────────────────────────────────────────
  // "Credit" customer = has a creditLimit set. Walk-in/cash customers
  // never get a creditLimit; only AR-eligible customers do.
  const creditCustomers = await prisma.customer.findMany({
    where: { organizationId: org.id, creditLimit: { not: null } },
  });
  const customerRows = await qbListAll(conn.realmId, accessToken, 'Customer', { includeInactive: false });
  for (const c of creditCustomers) {
    const { match, candidates } = pickByPatterns(customerRows, [c.name]);
    const r: ResolveResult = {
      entry: { entityType: 'customer', localId: c.id, qbEntity: 'Customer', namePatterns: [c.name], sourceLabel: `credit_customer(${c.name})` },
      match: match ? { id: String(match.Id), name: nameOf(match), active: activeOf(match) } : null,
      candidates: candidates.map((c2) => ({ id: String(c2.Id), name: nameOf(c2), active: activeOf(c2) })),
      reason: match ? undefined : 'no QB customer match — create in QB',
    };
    results.push(r);
    if (r.match) resolved++;
    else unresolved++;
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log(`\n=== Discovery Plan (${results.length} entries; ${resolved} resolved, ${unresolved} unresolved) ===\n`);
  for (const r of results) {
    const e: any = r.entry;
    const label = e.sourceLabel
      ? `${e.entityType}.${e.localId.slice(0, 8)}… (${e.sourceLabel})`
      : `${e.entityType}.${e.localId}`;
    if (r.match) {
      console.log(`  ✅ ${label.padEnd(50)} -> qb_id=${r.match.id} ("${r.match.name}")`);
    } else {
      console.log(`  ❌ ${label.padEnd(50)} -> ${r.reason}`);
      if (r.candidates.length) {
        for (const c of r.candidates.slice(0, 3)) {
          console.log(`        candidate: id=${c.id} active=${c.active} name="${c.name}"`);
        }
      }
    }
  }

  if (apply) {
    console.log(`\n=== Applying ${resolved} resolved mappings ===`);
    let written = 0;
    for (const r of results) {
      if (!r.match) continue;
      await upsertMapping(org.id, r.entry.entityType, r.entry.localId, r.match.id, r.match.name);
      written++;
    }
    console.log(`Upserted ${written} mappings into qb_entity_mappings.`);
  } else {
    console.log(`\n(dry-run; pass --apply to upsert)`);
  }

  await prisma.$disconnect();
  process.exit(unresolved > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[qb-seed-discover] FATAL:', err);
  await prisma.$disconnect();
  process.exit(2);
});
