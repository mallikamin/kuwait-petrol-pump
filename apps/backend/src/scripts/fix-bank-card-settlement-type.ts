/**
 * Fix bank_card_settlement mapping type from "account" to "bank"
 *
 * Issue: bank_card_settlement was incorrectly mapped as entityType="account"
 * but it should be entityType="bank" because ABL Bank is a Bank account in QB.
 *
 * Reference: kuwait-needs.ts line 60-67 defines bank_card_settlement with expectedQBTypes: ['Bank']
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Fix] Starting bank_card_settlement type correction...');

  // Find the mapping
  const mapping = await prisma.qBEntityMapping.findFirst({
    where: {
      entityType: 'account',
      localId: 'bank_card_settlement',
      isActive: true,
    },
  });

  if (!mapping) {
    console.log('[Fix] ❌ No active mapping found for bank_card_settlement with type "account"');
    console.log('[Fix] Checking if already fixed...');

    const bankMapping = await prisma.qBEntityMapping.findFirst({
      where: {
        entityType: 'bank',
        localId: 'bank_card_settlement',
        isActive: true,
      },
    });

    if (bankMapping) {
      console.log('[Fix] ✅ Mapping already has correct type "bank"');
      console.log('[Fix] Current state:', {
        id: bankMapping.id,
        entityType: bankMapping.entityType,
        localId: bankMapping.localId,
        qbId: bankMapping.qbId,
        qbName: bankMapping.qbName,
      });
    } else {
      console.log('[Fix] ⚠️  No mapping found for bank_card_settlement at all');
    }

    return;
  }

  console.log('[Fix] Found mapping to update:', {
    id: mapping.id,
    currentType: mapping.entityType,
    localId: mapping.localId,
    qbId: mapping.qbId,
    qbName: mapping.qbName,
  });

  // Update to correct type
  const updated = await prisma.qBEntityMapping.update({
    where: { id: mapping.id },
    data: { entityType: 'bank' },
  });

  console.log('[Fix] ✅ Successfully updated mapping type to "bank"');
  console.log('[Fix] Updated record:', {
    id: updated.id,
    newType: updated.entityType,
    localId: updated.localId,
    qbId: updated.qbId,
    qbName: updated.qbName,
  });
}

main()
  .catch((error) => {
    console.error('[Fix] Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
