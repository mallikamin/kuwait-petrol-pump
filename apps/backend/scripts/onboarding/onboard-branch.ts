// Onboard a new branch under an existing organization.
//
// Usage:
//   tsx scripts/onboarding/onboard-branch.ts \
//     --org-code se --code b01 --name "Sundar Estate Branch 01" \
//     [--location "<address>"]
//
// Idempotent: re-running with the same (org-code, code) returns the
// existing branch. Branch codes are unique within an org.

import { PrismaClient } from '@prisma/client';
import { normalizeCode, parseArgs, requireArg } from './shared';

const prisma = new PrismaClient();

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true') {
    console.log(`
Usage:
  tsx scripts/onboarding/onboard-branch.ts \\
    --org-code <org-code> --code <branch-code> --name "<display name>" \\
    [--location "<address>"]

Required: --org-code, --code, --name
`);
    return;
  }

  const orgCode = normalizeCode(requireArg(args, 'org-code', 'onboard-branch'), 'organization');
  const branchCode = normalizeCode(requireArg(args, 'code', 'onboard-branch'), 'branch');
  const name = requireArg(args, 'name', 'onboard-branch');
  const location = args.location || null;

  const org = await prisma.organization.findUnique({ where: { code: orgCode } });
  if (!org) {
    throw new Error(`No organization with code "${orgCode}". Create it first with onboard-client.ts.`);
  }

  const existing = await prisma.branch.findFirst({
    where: { organizationId: org.id, code: branchCode },
  });
  if (existing) {
    console.log(`Branch "${orgCode}/${branchCode}" already exists:`);
    console.log(`  id:       ${existing.id}`);
    console.log(`  name:     ${existing.name}`);
    console.log(`  location: ${existing.location}`);
    console.log(`(no changes made — onboard-branch is idempotent)`);
    return;
  }

  const branch = await prisma.branch.create({
    data: {
      organizationId: org.id,
      code: branchCode,
      name,
      location,
      isActive: true,
    },
  });

  console.log('Created branch:');
  console.log(`  id:           ${branch.id}`);
  console.log(`  org:          ${org.code} (${org.name})`);
  console.log(`  code:         ${branch.code}`);
  console.log(`  name:         ${branch.name}`);
  console.log(`  location:     ${branch.location}`);
  console.log(`  isActive:     ${branch.isActive}`);
  console.log(`\nNext step: add users with onboard-user.ts.`);
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
