// Onboard a new client (Organization) into the multi-tenant pool.
//
// Usage:
//   tsx scripts/onboarding/onboard-client.ts \
//     --code se --name "Sundar Estate" \
//     --company-name "Sundar Estate Filling Station" \
//     --company-address "Lahore, Pakistan" \
//     [--currency PKR] [--timezone Asia/Karachi] [--demo]
//
// Idempotent: re-running with the same --code is a no-op (prints the
// existing org and exits 0). Codes are globally unique across the pool.

import { PrismaClient } from '@prisma/client';
import { normalizeCode, parseArgs, requireArg } from './shared';

const prisma = new PrismaClient();

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true') {
    console.log(`
Usage:
  tsx scripts/onboarding/onboard-client.ts \\
    --code <short-code> --name "<display name>" \\
    --company-name "<report header name>" \\
    --company-address "<report header address>" \\
    [--currency PKR] [--timezone Asia/Karachi] [--demo]

Required: --code, --name, --company-name, --company-address
`);
    return;
  }

  const code = normalizeCode(requireArg(args, 'code', 'onboard-client'), 'organization');
  const name = requireArg(args, 'name', 'onboard-client');
  const companyName = requireArg(args, 'company-name', 'onboard-client');
  const companyAddress = requireArg(args, 'company-address', 'onboard-client');
  const currency = args.currency || 'PKR';
  const timezone = args.timezone || 'Asia/Karachi';
  const isDemo = args.demo === 'true';

  const existing = await prisma.organization.findUnique({ where: { code } });
  if (existing) {
    console.log(`Organization with code "${code}" already exists:`);
    console.log(`  id:           ${existing.id}`);
    console.log(`  name:         ${existing.name}`);
    console.log(`  companyName:  ${existing.companyName}`);
    console.log(`  isDemo:       ${existing.isDemo}`);
    console.log(`  tenancyMode:  ${existing.tenancyMode}`);
    console.log(`(no changes made — onboard-client is idempotent)`);
    return;
  }

  const org = await prisma.organization.create({
    data: {
      code,
      name,
      companyName,
      companyAddress,
      currency,
      timezone,
      isDemo,
      tenancyMode: 'pool',
    },
  });

  console.log('Created organization:');
  console.log(`  id:             ${org.id}`);
  console.log(`  code:           ${org.code}`);
  console.log(`  name:           ${org.name}`);
  console.log(`  companyName:    ${org.companyName}`);
  console.log(`  companyAddress: ${org.companyAddress}`);
  console.log(`  currency:       ${org.currency}`);
  console.log(`  timezone:       ${org.timezone}`);
  console.log(`  isDemo:         ${org.isDemo}`);
  console.log(`  tenancyMode:    ${org.tenancyMode}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Add a branch:`);
  console.log(`     tsx scripts/onboarding/onboard-branch.ts --org-code ${org.code} --code b01 --name "<branch name>" --location "<address>"`);
  console.log(`  2. Add the first user:`);
  console.log(`     tsx scripts/onboarding/onboard-user.ts --org-code ${org.code} --branch-code b01 --username ${org.code}-b01-001 --role operator --password <pw>`);
  console.log(`  3. Owner connects QuickBooks via the in-app "Connect QuickBooks" flow.`);
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
