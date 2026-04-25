// Onboard a new user under an existing organization (and optionally a
// specific branch).
//
// Usage:
//   tsx scripts/onboarding/onboard-user.ts \
//     --org-code se --branch-code b01 \
//     --username se-b01-001 --role operator \
//     --password seb123 \
//     [--full-name "Operator One"] [--email "ops@example.com"]
//
// Omit --branch-code for org-level users (e.g. accountant covering all
// branches). Idempotent: re-running with the same (org-code, username)
// returns the existing user without changing the password.
//
// Username convention (recommended):
//   <org-code>-<branch-code>-<seq-or-role>      branch-scoped
//   <org-code>-<role>                            org-scoped
// Examples:
//   se-b01-001        Operator/cashier #1 at Sundar Estate, Branch 01
//   se-b01-acc        Accountant at Sundar Estate, Branch 01
//   se-acc            Accountant covering all Sundar Estate branches

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  normalizeCode,
  normalizeRole,
  normalizeUsername,
  parseArgs,
  requireArg,
} from './shared';

const prisma = new PrismaClient();

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true') {
    console.log(`
Usage:
  tsx scripts/onboarding/onboard-user.ts \\
    --org-code <org-code> [--branch-code <branch-code>] \\
    --username <username> --role <admin|manager|accountant|cashier|operator> \\
    --password <password> \\
    [--full-name "<full name>"] [--email "<email>"]

Required: --org-code, --username, --role, --password
Optional: --branch-code (omit for org-level user), --full-name, --email
`);
    return;
  }

  const orgCode = normalizeCode(requireArg(args, 'org-code', 'onboard-user'), 'organization');
  const username = normalizeUsername(requireArg(args, 'username', 'onboard-user'));
  const role = normalizeRole(requireArg(args, 'role', 'onboard-user'));
  const password = requireArg(args, 'password', 'onboard-user');
  const fullName = args['full-name'] || null;
  const email = args.email || null;
  const branchCodeRaw = args['branch-code'];

  const org = await prisma.organization.findUnique({ where: { code: orgCode } });
  if (!org) {
    throw new Error(`No organization with code "${orgCode}". Create it first with onboard-client.ts.`);
  }

  let branchId: string | null = null;
  let branchLabel = '(org-level — all branches)';
  if (branchCodeRaw && branchCodeRaw !== 'true') {
    const branchCode = normalizeCode(branchCodeRaw, 'branch');
    const branch = await prisma.branch.findFirst({
      where: { organizationId: org.id, code: branchCode },
    });
    if (!branch) {
      throw new Error(`No branch with code "${branchCode}" under org "${orgCode}". Create it first with onboard-branch.ts.`);
    }
    branchId = branch.id;
    branchLabel = `${branch.code} (${branch.name})`;
  }

  const existing = await prisma.user.findFirst({
    where: { organizationId: org.id, username },
  });
  if (existing) {
    console.log(`User "${orgCode}/${username}" already exists:`);
    console.log(`  id:       ${existing.id}`);
    console.log(`  role:     ${existing.role}`);
    console.log(`  branchId: ${existing.branchId ?? '(org-level)'}`);
    console.log(`(no changes made — onboard-user is idempotent and does NOT rotate passwords)`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      branchId,
      username,
      email,
      passwordHash,
      fullName,
      role,
      isActive: true,
    },
  });

  console.log('Created user:');
  console.log(`  id:        ${user.id}`);
  console.log(`  org:       ${org.code} (${org.name})`);
  console.log(`  branch:    ${branchLabel}`);
  console.log(`  username:  ${user.username}`);
  console.log(`  role:      ${user.role}`);
  console.log(`  fullName:  ${user.fullName ?? '(not set)'}`);
  console.log(`  email:     ${user.email ?? '(not set)'}`);
  console.log(`\nLogin: username "${user.username}" with the password supplied (case-insensitive on username).`);
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
