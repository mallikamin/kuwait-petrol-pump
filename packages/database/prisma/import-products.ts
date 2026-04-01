import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { importProductsFromXlsx } from '../../../apps/backend/src/modules/products/product-import.service';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

interface CliArgs {
  filePath: string;
  organizationId?: string;
  defaultCategory?: string;
  dryRun: boolean;
}

function loadEnvFile(filePath: string, override = false): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (override || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadEnvironment(): void {
  loadEnvFile(path.join(REPO_ROOT, 'apps', 'backend', '.env'), true);
  loadEnvFile(path.join(REPO_ROOT, '.env'));
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    filePath: path.join(REPO_ROOT, 'data', 'inventory-list.xlsx'),
    dryRun: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === '--file' && next) {
      args.filePath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (current === '--organizationId' && next) {
      args.organizationId = next;
      i += 1;
      continue;
    }

    if (current === '--defaultCategory' && next) {
      args.defaultCategory = next;
      i += 1;
      continue;
    }

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--apply') {
      args.dryRun = false;
    }
  }

  return args;
}

async function resolveOrganizationId(
  prisma: PrismaClient,
  organizationId?: string
): Promise<string> {
  if (organizationId) {
    return organizationId;
  }

  const firstOrganization = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!firstOrganization) {
    throw new Error(
      'No organization found. Pass --organizationId <uuid> or create seed org first.'
    );
  }

  return firstOrganization.id;
}

async function main() {
  loadEnvironment();
  const prisma = new PrismaClient();
  const args = parseCliArgs(process.argv.slice(2));

  try {
    const organizationId = await resolveOrganizationId(prisma, args.organizationId);

    console.log(
      `[Inventory Import] Starting ${args.dryRun ? 'dry-run' : 'apply'} import for org ${organizationId}`
    );
    console.log(`[Inventory Import] Source file: ${args.filePath}`);

    const summary = await importProductsFromXlsx(prisma, {
      organizationId,
      filePath: args.filePath,
      dryRun: args.dryRun,
      defaultCategory: args.defaultCategory,
    });

    console.log('[Inventory Import] Summary');
    console.table({
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
      errors: summary.errors,
      dryRun: summary.dryRun,
    });

    if (summary.details.errors.length > 0) {
      console.log('[Inventory Import] Errors');
      console.table(summary.details.errors.slice(0, 20));
    }

    if (summary.details.skipped.length > 0) {
      console.log('[Inventory Import] Skipped');
      console.table(summary.details.skipped.slice(0, 20));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[Inventory Import] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
