// Clone master/lookup data from one organization to another. Used during
// new-tenant onboarding to seed the same dropdowns + facility structure
// as a known-good reference org (typically the demo).
//
// CLONES (master / dropdown data only):
//   - dispensing units + nozzles (branch-scoped; requires --branch-mapping)
//   - products
//   - suppliers
//   - customers (currentBalance reset to 0 — each org owns its own credit)
//   - expense_accounts
//   - banks (org-scoped or branch-scoped; branch-scoped banks are
//     translated through --branch-mapping)
//
// REPORTS BUT DOES NOT CLONE:
//   - fuel-prices: the fuel_prices table is GLOBAL (no organization_id
//     column), so prices set on the source org are already visible to
//     the target org. The "fuel-prices" include just lists what's
//     currently active for operator visibility — no inserts.
//
// DOES NOT CLONE (transactional data, per-tenant state):
//   - sales, meter readings, bifurcations
//   - shift instances, fuel/non-fuel sales, audit log
//   - inventory bootstrap / gain-loss
//   - cash ledger, expense entries, cash reconciliations
//   - PSO topups, customer receipts, customer advances
//   - purchase orders, supplier payments, stock receipts
//   - QB connections, QB mappings, QB sync queue, QB logs, QB snapshots
//   - shift definitions (caller decides shift schedule per their ops)
//
// Usage:
//   tsx scripts/onboarding/clone-master-data.ts \
//     --from-org kpc --to-org se \
//     --branch-mapping b01:b01 \
//     [--include products,suppliers,customers,expense-accounts,branch-structure,banks,fuel-prices]
//
// Idempotent: skips records that already exist in the target (matched
// by org-scoped natural key — sku for products, name for suppliers/
// customers/expense_accounts, unitNumber for dispensing units).

import { PrismaClient } from '@prisma/client';
import { normalizeCode, parseArgs, requireArg } from './shared';

const prisma = new PrismaClient();

type IncludeKey =
  | 'branch-structure'
  | 'products'
  | 'suppliers'
  | 'customers'
  | 'expense-accounts'
  | 'banks'
  | 'fuel-prices';

const ALL_INCLUDES: IncludeKey[] = [
  'branch-structure',
  'products',
  'suppliers',
  'customers',
  'expense-accounts',
  'banks',
  'fuel-prices',
];

interface CloneStats {
  created: number;
  skipped: number;
  total: number;
}

interface BranchMap {
  fromBranchId: string;
  toBranchId: string;
  fromBranchCode: string;
  toBranchCode: string;
}

async function cloneProducts(fromOrgId: string, toOrgId: string): Promise<CloneStats> {
  const stats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const source = await prisma.product.findMany({ where: { organizationId: fromOrgId } });
  stats.total = source.length;

  for (const p of source) {
    const exists = await prisma.product.findFirst({
      where: { organizationId: toOrgId, sku: p.sku },
    });
    if (exists) {
      stats.skipped++;
      continue;
    }
    await prisma.product.create({
      data: {
        organizationId: toOrgId,
        sku: p.sku,
        name: p.name,
        category: p.category,
        barcode: p.barcode,
        unitPrice: p.unitPrice,
        costPrice: p.costPrice,
        isActive: p.isActive,
        lowStockThreshold: p.lowStockThreshold,
        // qbItemId intentionally NOT copied — target org will sync to its own QB
      },
    });
    stats.created++;
  }
  return stats;
}

async function cloneSuppliers(fromOrgId: string, toOrgId: string): Promise<CloneStats> {
  const stats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const source = await prisma.supplier.findMany({ where: { organizationId: fromOrgId } });
  stats.total = source.length;

  for (const s of source) {
    const exists = await prisma.supplier.findFirst({
      where: { organizationId: toOrgId, name: s.name },
    });
    if (exists) {
      stats.skipped++;
      continue;
    }
    await prisma.supplier.create({
      data: {
        organizationId: toOrgId,
        name: s.name,
        code: s.code,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        paymentTerms: s.paymentTerms,
        creditDays: s.creditDays,
        isActive: s.isActive,
        // qbVendorId, qbSynced intentionally NOT copied
      },
    });
    stats.created++;
  }
  return stats;
}

async function cloneCustomers(fromOrgId: string, toOrgId: string): Promise<CloneStats> {
  const stats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const source = await prisma.customer.findMany({ where: { organizationId: fromOrgId } });
  stats.total = source.length;

  for (const c of source) {
    // Customers have no DB-level unique on name, but for idempotent re-runs
    // we dedupe by name within the target org. Operators can manually add
    // duplicates with distinct names if needed.
    const exists = await prisma.customer.findFirst({
      where: { organizationId: toOrgId, name: c.name },
    });
    if (exists) {
      stats.skipped++;
      continue;
    }
    await prisma.customer.create({
      data: {
        organizationId: toOrgId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        vehicleNumbers: c.vehicleNumbers,
        creditLimit: c.creditLimit,
        creditDays: c.creditDays,
        // currentBalance reset to 0 — target org owns its own credit ledger
        currentBalance: 0,
        isActive: c.isActive,
      },
    });
    stats.created++;
  }
  return stats;
}

async function cloneExpenseAccounts(fromOrgId: string, toOrgId: string): Promise<CloneStats> {
  const stats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const source = await prisma.expenseAccount.findMany({
    where: { organizationId: fromOrgId },
    orderBy: { sortOrder: 'asc' },
  });
  stats.total = source.length;

  for (const e of source) {
    const exists = await prisma.expenseAccount.findFirst({
      where: { organizationId: toOrgId, label: e.label },
    });
    if (exists) {
      stats.skipped++;
      continue;
    }
    await prisma.expenseAccount.create({
      data: {
        organizationId: toOrgId,
        label: e.label,
        qbAccountName: e.qbAccountName,
        sortOrder: e.sortOrder,
        isActive: e.isActive,
      },
    });
    stats.created++;
  }
  return stats;
}

async function cloneBanks(
  fromOrgId: string,
  toOrgId: string,
  branchMap: BranchMap | null,
): Promise<CloneStats> {
  const stats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const source = await prisma.bank.findMany({
    where: { organizationId: fromOrgId },
    orderBy: { name: 'asc' },
  });
  stats.total = source.length;

  for (const b of source) {
    // Translate branch_id through the mapping. If a branch-scoped bank
    // exists in source but no mapping is provided, fall back to org-level
    // (NULL branch_id) on the target so the bank still shows in dropdowns.
    let targetBranchId: string | null = null;
    if (b.branchId) {
      if (branchMap && b.branchId === branchMap.fromBranchId) {
        targetBranchId = branchMap.toBranchId;
      } else {
        targetBranchId = null; // unmapped source branch → drop to org-level
      }
    }

    // No DB unique constraint on (org_id, name); enforce idempotency here.
    const exists = await prisma.bank.findFirst({
      where: { organizationId: toOrgId, name: b.name },
    });
    if (exists) {
      stats.skipped++;
      continue;
    }
    await prisma.bank.create({
      data: {
        organizationId: toOrgId,
        branchId: targetBranchId,
        name: b.name,
        code: b.code,
        accountNumber: b.accountNumber,
        accountTitle: b.accountTitle,
        isActive: b.isActive,
      },
    });
    stats.created++;
  }
  return stats;
}

async function reportFuelPrices(): Promise<{ count: number }> {
  // fuel_prices has NO organization_id column — the table is global.
  // Prices set anywhere are visible to every org. This handler is a
  // visibility check, not a copy operation, so onboarding operators
  // can confirm what's currently active.
  const active = await prisma.fuelPrice.findMany({
    where: { effectiveTo: null },
    include: { fuelType: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  for (const p of active) {
    console.log(
      `    ${p.fuelType.code}: ${p.pricePerLiter} (effective from ${p.effectiveFrom.toISOString().slice(0, 10)})`,
    );
  }
  return { count: active.length };
}

async function cloneBranchStructure(map: BranchMap): Promise<{
  units: CloneStats;
  nozzles: CloneStats;
}> {
  const unitStats: CloneStats = { created: 0, skipped: 0, total: 0 };
  const nozzleStats: CloneStats = { created: 0, skipped: 0, total: 0 };

  const sourceUnits = await prisma.dispensingUnit.findMany({
    where: { branchId: map.fromBranchId },
    include: { nozzles: true },
    orderBy: { unitNumber: 'asc' },
  });
  unitStats.total = sourceUnits.length;
  nozzleStats.total = sourceUnits.reduce((sum, u) => sum + u.nozzles.length, 0);

  for (const sourceUnit of sourceUnits) {
    let targetUnit = await prisma.dispensingUnit.findFirst({
      where: { branchId: map.toBranchId, unitNumber: sourceUnit.unitNumber },
    });
    if (targetUnit) {
      unitStats.skipped++;
    } else {
      targetUnit = await prisma.dispensingUnit.create({
        data: {
          branchId: map.toBranchId,
          unitNumber: sourceUnit.unitNumber,
          name: sourceUnit.name,
          isActive: sourceUnit.isActive,
        },
      });
      unitStats.created++;
    }

    for (const sourceNozzle of sourceUnit.nozzles) {
      const exists = await prisma.nozzle.findFirst({
        where: { dispensingUnitId: targetUnit.id, nozzleNumber: sourceNozzle.nozzleNumber },
      });
      if (exists) {
        nozzleStats.skipped++;
        continue;
      }
      await prisma.nozzle.create({
        data: {
          dispensingUnitId: targetUnit.id,
          nozzleNumber: sourceNozzle.nozzleNumber,
          name: sourceNozzle.name,
          fuelTypeId: sourceNozzle.fuelTypeId, // fuel_types is global, FK works as-is
          meterType: sourceNozzle.meterType,
          isActive: sourceNozzle.isActive,
        },
      });
      nozzleStats.created++;
    }
  }

  return { units: unitStats, nozzles: nozzleStats };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true') {
    console.log(`
Usage:
  tsx scripts/onboarding/clone-master-data.ts \\
    --from-org <source-org-code> --to-org <target-org-code> \\
    [--branch-mapping <fromCode>:<toCode>] \\
    [--include <comma-separated: ${ALL_INCLUDES.join(',')}>]

Required: --from-org, --to-org
Optional:
  --branch-mapping  Required only if "branch-structure" is in --include.
                    Maps a source branch code to a target branch code.
  --include         Comma-separated subset. Default: all.
`);
    return;
  }

  const fromOrgCode = normalizeCode(requireArg(args, 'from-org', 'clone-master-data'), 'organization');
  const toOrgCode = normalizeCode(requireArg(args, 'to-org', 'clone-master-data'), 'organization');

  if (fromOrgCode === toOrgCode) {
    throw new Error(`--from-org and --to-org must differ (both = "${fromOrgCode}").`);
  }

  const includeRaw = args.include && args.include !== 'true' ? args.include : ALL_INCLUDES.join(',');
  const include = includeRaw.split(',').map((s) => s.trim()) as IncludeKey[];
  for (const k of include) {
    if (!ALL_INCLUDES.includes(k)) {
      throw new Error(`Unknown --include item "${k}". Valid: ${ALL_INCLUDES.join(', ')}`);
    }
  }

  const fromOrg = await prisma.organization.findUnique({ where: { code: fromOrgCode } });
  if (!fromOrg) throw new Error(`Source org "${fromOrgCode}" not found.`);

  const toOrg = await prisma.organization.findUnique({ where: { code: toOrgCode } });
  if (!toOrg) throw new Error(`Target org "${toOrgCode}" not found.`);

  console.log(`Clone master data: ${fromOrgCode} (${fromOrg.name}) -> ${toOrgCode} (${toOrg.name})`);
  console.log(`Include: ${include.join(', ')}`);
  console.log();

  let branchMap: BranchMap | null = null;
  if (include.includes('branch-structure')) {
    const mappingRaw = requireArg(args, 'branch-mapping', 'clone-master-data');
    const [fromCode, toCode] = mappingRaw.split(':');
    if (!fromCode || !toCode) {
      throw new Error(`Invalid --branch-mapping "${mappingRaw}". Expected "fromCode:toCode".`);
    }
    const fromBranchCode = normalizeCode(fromCode, 'source branch');
    const toBranchCode = normalizeCode(toCode, 'target branch');

    const fromBranch = await prisma.branch.findFirst({
      where: { organizationId: fromOrg.id, code: fromBranchCode },
    });
    if (!fromBranch) {
      throw new Error(`Source branch "${fromBranchCode}" not found in org "${fromOrgCode}".`);
    }
    const toBranch = await prisma.branch.findFirst({
      where: { organizationId: toOrg.id, code: toBranchCode },
    });
    if (!toBranch) {
      throw new Error(`Target branch "${toBranchCode}" not found in org "${toOrgCode}".`);
    }
    branchMap = {
      fromBranchId: fromBranch.id,
      toBranchId: toBranch.id,
      fromBranchCode,
      toBranchCode,
    };
  }

  if (include.includes('branch-structure') && branchMap) {
    console.log(`[branch-structure] ${branchMap.fromBranchCode} -> ${branchMap.toBranchCode}`);
    const r = await cloneBranchStructure(branchMap);
    console.log(`  dispensing units: created=${r.units.created} skipped=${r.units.skipped} total=${r.units.total}`);
    console.log(`  nozzles:          created=${r.nozzles.created} skipped=${r.nozzles.skipped} total=${r.nozzles.total}`);
  }

  if (include.includes('products')) {
    const r = await cloneProducts(fromOrg.id, toOrg.id);
    console.log(`[products]         created=${r.created} skipped=${r.skipped} total=${r.total}`);
  }

  if (include.includes('suppliers')) {
    const r = await cloneSuppliers(fromOrg.id, toOrg.id);
    console.log(`[suppliers]        created=${r.created} skipped=${r.skipped} total=${r.total}`);
  }

  if (include.includes('customers')) {
    const r = await cloneCustomers(fromOrg.id, toOrg.id);
    console.log(`[customers]        created=${r.created} skipped=${r.skipped} total=${r.total}`);
  }

  if (include.includes('expense-accounts')) {
    const r = await cloneExpenseAccounts(fromOrg.id, toOrg.id);
    console.log(`[expense-accounts] created=${r.created} skipped=${r.skipped} total=${r.total}`);
  }

  if (include.includes('banks')) {
    const r = await cloneBanks(fromOrg.id, toOrg.id, branchMap);
    console.log(`[banks]            created=${r.created} skipped=${r.skipped} total=${r.total}`);
  }

  if (include.includes('fuel-prices')) {
    console.log(`[fuel-prices]      table is GLOBAL (shared across orgs); current active prices visible to ${toOrgCode}:`);
    const r = await reportFuelPrices();
    if (r.count === 0) {
      console.log('    (no active fuel prices set anywhere — operator must add prices via the Fuel Prices page)');
    }
  }

  console.log();
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
