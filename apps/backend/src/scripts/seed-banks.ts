/**
 * Seed Banks Script
 * Creates bank entities matching QB bank accounts
 * Run: npx ts-node src/scripts/seed-banks.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed Banks] Starting...');

  // Get organization (assuming single org setup)
  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('No organization found. Run seed-demo-data.ts first.');
  }

  console.log(`[Seed Banks] Using organization: ${org.name} (${org.id})`);

  // QB Bank Accounts from kuwaitpos.duckdns.org/api/quickbooks/banks:
  // 88 - ABL Bank
  // 89 - BOP Sundar
  // 91 - Faysal bank
  // 92 - MCB Bank
  // 90 - Cash in Hand

  const banks = [
    { name: 'ABL Bank Cards', code: 'ABL', accountNumber: 'ABL-CARDS' },
    { name: 'BOP Bank Cards', code: 'BOP', accountNumber: 'BOP-CARDS' },
    { name: 'Faysal Bank Cards', code: 'FAYSAL', accountNumber: 'FAYSAL-CARDS' },
    { name: 'MCB Bank Cards', code: 'MCB', accountNumber: 'MCB-CARDS' },
    { name: 'Cash in Hand', code: 'CASH', accountNumber: 'CASH-HAND' },
  ];

  for (const bank of banks) {
    const existing = await prisma.bank.findFirst({
      where: { organizationId: org.id, code: bank.code },
    });

    if (existing) {
      console.log(`[Seed Banks] ✓ Bank "${bank.name}" already exists`);
      continue;
    }

    await prisma.bank.create({
      data: {
        organizationId: org.id,
        branchId: null, // Org-level bank
        name: bank.name,
        code: bank.code,
        accountNumber: bank.accountNumber,
        accountTitle: bank.name,
        isActive: true,
      },
    });

    console.log(`[Seed Banks] ✓ Created bank: ${bank.name}`);
  }

  console.log('[Seed Banks] Complete!');
}

main()
  .catch((error) => {
    console.error('[Seed Banks] Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
