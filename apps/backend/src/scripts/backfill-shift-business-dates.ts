/**
 * Backfill Script: Fix shift_instance business dates
 *
 * Problem: Some shift instances may have incorrect `date` values due to using
 * server system timezone instead of business timezone (Asia/Karachi).
 *
 * Solution: Recalculate business date for each shift instance based on:
 * 1. Organization's timezone setting
 * 2. The `openedAt` timestamp converted to business timezone
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-shift-business-dates.ts [--dry-run]
 */

import { prisma } from '../config/database';
import { toZonedTime, format } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

interface FixResult {
  shiftInstanceId: string;
  oldDate: Date;
  newDate: Date;
  timezone: string;
  openedAt: Date;
}

async function calculateBusinessDate(openedAt: Date, timezone: string): Promise<Date> {
  // Convert UTC timestamp to business timezone
  const zonedTime = toZonedTime(openedAt, timezone);

  // Get start of day in business timezone
  const businessDayStart = startOfDay(zonedTime);

  // Convert back to UTC Date object (but preserving the business date)
  const utcBusinessDate = new Date(format(businessDayStart, 'yyyy-MM-dd', { timeZone: timezone }));
  utcBusinessDate.setUTCHours(0, 0, 0, 0);

  return utcBusinessDate;
}

async function backfillShiftBusinessDates(dryRun: boolean = true) {
  console.log('🔍 Starting shift business date backfill...');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be saved)' : 'LIVE (changes will be saved)'}\n`);

  // Fetch all organizations with their timezone
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      timezone: true,
    },
  });

  console.log(`Found ${organizations.length} organizations\n`);

  let totalFixed = 0;
  let totalSkipped = 0;
  const fixes: FixResult[] = [];

  for (const org of organizations) {
    console.log(`\n📊 Processing organization: ${org.name} (${org.timezone})`);

    // Fetch all shift instances for this organization
    const shiftInstances = await prisma.shiftInstance.findMany({
      where: {
        branch: {
          organizationId: org.id,
        },
      },
      include: {
        branch: true,
        shift: true,
      },
      orderBy: {
        openedAt: 'desc',
      },
    });

    console.log(`  Found ${shiftInstances.length} shift instances`);

    for (const si of shiftInstances) {
      if (!si.openedAt) {
        console.log(`  ⚠️  Skipping shift instance ${si.id}: no openedAt timestamp`);
        totalSkipped++;
        continue;
      }

      // Calculate correct business date
      const correctBusinessDate = await calculateBusinessDate(si.openedAt, org.timezone);

      // Compare with current date
      const currentDateStr = format(si.date, 'yyyy-MM-dd');
      const correctDateStr = format(correctBusinessDate, 'yyyy-MM-dd');

      if (currentDateStr !== correctDateStr) {
        console.log(`  🔧 Shift ${si.id} needs fix:`);
        console.log(`      Current date: ${currentDateStr}`);
        console.log(`      Correct date: ${correctDateStr}`);
        console.log(`      OpenedAt UTC: ${si.openedAt.toISOString()}`);

        fixes.push({
          shiftInstanceId: si.id,
          oldDate: si.date,
          newDate: correctBusinessDate,
          timezone: org.timezone,
          openedAt: si.openedAt,
        });

        if (!dryRun) {
          await prisma.shiftInstance.update({
            where: { id: si.id },
            data: { date: correctBusinessDate },
          });
          console.log(`      ✅ Updated`);
        }

        totalFixed++;
      } else {
        totalSkipped++;
      }
    }
  }

  console.log('\n\n📈 Summary:');
  console.log(`  Total shift instances checked: ${totalFixed + totalSkipped}`);
  console.log(`  Shift instances fixed: ${totalFixed}`);
  console.log(`  Shift instances correct: ${totalSkipped}`);

  if (fixes.length > 0) {
    console.log('\n\n📝 Detailed fixes:');
    for (const fix of fixes) {
      console.log(`  ${fix.shiftInstanceId}: ${format(fix.oldDate, 'yyyy-MM-dd')} → ${format(fix.newDate, 'yyyy-MM-dd')} (opened at ${fix.openedAt.toISOString()})`);
    }
  }

  if (dryRun && fixes.length > 0) {
    console.log('\n\n⚠️  DRY RUN: No changes were saved. Run without --dry-run to apply fixes.');
  } else if (!dryRun && fixes.length > 0) {
    console.log('\n\n✅ All fixes applied successfully!');
  } else {
    console.log('\n\n✅ All shift instances have correct business dates!');
  }

  return {
    totalChecked: totalFixed + totalSkipped,
    totalFixed,
    totalSkipped,
    fixes,
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');

  backfillShiftBusinessDates(dryRun)
    .then((result) => {
      console.log('\n✅ Backfill complete');
      process.exit(result.totalFixed > 0 && dryRun ? 1 : 0); // Exit code 1 if fixes needed and dry-run
    })
    .catch((error) => {
      console.error('\n❌ Backfill failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { backfillShiftBusinessDates };
