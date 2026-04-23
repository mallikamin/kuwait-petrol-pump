/**
 * Seed bank_account QB mappings for each local bank.
 *
 * The receive-payment handler resolves the DepositToAccount via
 * EntityMappingService.getQbId(org, 'bank_account', bankId) when bankId is
 * passed (non-cash receipts). Without these mapping rows, every non-cash
 * receipt falls back to 'default_checking' — the client asked for proper
 * per-bank routing (Scenario 8 Option B in the spec).
 *
 * Local bank "X Bank Cards" historically named for the card-swipe AR flow;
 * in practice the same banks are used for bank-transfer deposits. The
 * mapping below routes each to the corresponding QB checking account.
 *
 *   docker cp scripts/seed_bank_qb_mappings.js kuwaitpos-backend:/tmp/sb.js
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/sb.js ./sb.js && node sb.js --dry-run && rm sb.js'
 *   docker exec kuwaitpos-backend sh -c 'cd /app/apps/backend && cp /tmp/sb.js ./sb.js && node sb.js --execute && rm sb.js'
 */

const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry-run');
const EXEC = process.argv.includes('--execute');
if (!DRY && !EXEC) {
  console.error('Usage: node seed_bank_qb_mappings.js [--dry-run | --execute]');
  process.exit(1);
}

// Local bank name substring (case-insensitive) → QB bank account id.
// Preserved as substrings to tolerate the "Cards" suffix on the seed rows.
const BANK_NAME_TO_QB = [
  { match: /abl/i,     qbId: '88', qbName: 'ABL Bank' },
  { match: /bop/i,     qbId: '89', qbName: 'BOP Sundar' },
  { match: /faysal/i,  qbId: '91', qbName: 'Faysal bank' },
  { match: /mcb/i,     qbId: '92', qbName: 'MCB Bank' },
  { match: /cash in hand/i, qbId: '90', qbName: 'Cash in Hand' },
];

const prisma = new PrismaClient();

async function main() {
  console.log('Seed bank_account QB mappings');
  console.log('==============================');
  console.log('Mode:', DRY ? 'DRY-RUN' : 'EXECUTE');
  console.log();

  const conn = await prisma.qBConnection.findFirst({ where: { isActive: true }, select: { organizationId: true } });
  if (!conn) { console.error('No active QB connection'); process.exit(1); }
  const organizationId = conn.organizationId;

  const banks = await prisma.bank.findMany({ where: { organizationId, isActive: true } });
  console.log(`Active banks: ${banks.length}`);
  console.log();

  const plan = { alreadyOk: [], willCreate: [], blocked: [], unmapped: [] };

  for (const b of banks) {
    const hit = BANK_NAME_TO_QB.find((r) => r.match.test(b.name));
    if (!hit) {
      plan.unmapped.push(b);
      continue;
    }
    const existing = await prisma.qBEntityMapping.findFirst({
      where: { organizationId, entityType: 'bank_account', localId: b.id },
    });
    if (existing && existing.qbId === hit.qbId) {
      plan.alreadyOk.push({ bank: b, hit });
      continue;
    }
    if (existing && existing.qbId !== hit.qbId) {
      plan.blocked.push({ bank: b, hit, existing });
      continue;
    }
    // Also check if qb_id is already mapped to a different local_id (unique constraint)
    const qbHolder = await prisma.qBEntityMapping.findFirst({
      where: { organizationId, entityType: 'bank_account', qbId: hit.qbId },
    });
    if (qbHolder) {
      plan.blocked.push({ bank: b, hit, reason: `qb_id=${hit.qbId} already mapped to local_id=${qbHolder.localId}` });
      continue;
    }
    plan.willCreate.push({ bank: b, hit });
  }

  console.log(`Already OK:  ${plan.alreadyOk.length}`);
  console.log(`Will create: ${plan.willCreate.length}`);
  console.log(`Blocked:     ${plan.blocked.length}`);
  console.log(`Unmapped:    ${plan.unmapped.length}`);
  console.log();

  for (const w of plan.willCreate) {
    console.log(`  WILL  ${w.bank.name.padEnd(20)} (local=${w.bank.id.slice(0, 8)}) -> qb=${w.hit.qbId} ${w.hit.qbName}`);
  }
  for (const b of plan.blocked) {
    console.log(`  BLOCK ${b.bank.name.padEnd(20)} -> ${b.reason || JSON.stringify(b.existing)}`);
  }
  for (const u of plan.unmapped) {
    console.log(`  UNMAP ${u.name} (no substring match)`);
  }
  console.log();

  if (DRY || plan.willCreate.length === 0) {
    console.log(DRY ? 'Dry-run complete.' : 'Nothing to create.');
    await prisma.$disconnect();
    return;
  }

  console.log('Executing...');
  for (const w of plan.willCreate) {
    await prisma.qBEntityMapping.create({
      data: {
        organizationId,
        entityType: 'bank_account',
        localId: w.bank.id,
        qbId: w.hit.qbId,
        qbName: w.hit.qbName,
      },
    });
    console.log(`  CREATED ${w.bank.name} -> qb=${w.hit.qbId}`);
  }
  console.log();
  console.log(`Created ${plan.willCreate.length} mappings.`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
