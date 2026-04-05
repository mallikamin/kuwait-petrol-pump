/**
 * Seed March 2026 meter readings (March 1 - April 2)
 * Creates progressive readings to test backward derivation chain
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50'; // Main Branch
const ORG_ID = 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
const CASHIER_ID = '9a9f2d10-e908-4a50-8e24-410352d66766'; // Admin

// Nozzle IDs (from production)
const NOZZLES = [
  { id: '6412462b-19d8-4168-8cbd-d1274990f6c7', name: 'D1N1-HSD', dispenser: 'D1' },
  { id: '9e0f58dd-0f4f-4ad7-bbf3-1cb742792426', name: 'D1N2-HSD', dispenser: 'D1' },
  { id: 'f1e5e5cf-2d7e-4770-9330-078517d99eae', name: 'D2N1-HSD', dispenser: 'D2' },
  { id: '834c1f12-ab71-431f-b0fd-cb536444335d', name: 'D3N1-PMG', dispenser: 'D3' },
  { id: '5c5360cf-0ffa-44a6-9890-53fee1205f49', name: 'D4N1-PMG', dispenser: 'D4' },
  { id: '5022dc79-f077-4f4c-acf2-5a436c9bad79', name: 'D4N2-PMG', dispenser: 'D4' },
];

// Shift IDs (from production)
const SHIFTS = {
  day: '2cf99710-4971-4357-9673-d5f1ebf4d256',
  night: '3a86cb44-b352-45bc-8dc5-bab29425870d',
};

async function main() {
  console.log('🌱 Seeding March 2026 meter readings...\n');

  // Starting meter values (aligned with April 3 data)
  let meterValues: Record<string, number> = {
    [NOZZLES[0].id]: 950000, // D1N1-HSD starts at 950k, ends at 1000000 by Apr 3
    [NOZZLES[1].id]: 980000, // D1N2-HSD
    [NOZZLES[2].id]: 970000, // D2N1-HSD
    [NOZZLES[3].id]: 980000, // D3N1-PMG
    [NOZZLES[4].id]: 960000, // D4N1-PMG
    [NOZZLES[5].id]: 950000, // D4N2-PMG
  };

  // Sales per shift (liters) - realistic variation
  const dailySales: Record<string, { day: number; night: number }> = {};
  for (let i = 0; i < 33; i++) {
    NOZZLES.forEach((nozzle) => {
      if (!dailySales[nozzle.id]) dailySales[nozzle.id] = { day: 0, night: 0 };
      // Random sales between 100-600 liters per shift
      dailySales[nozzle.id].day = Math.floor(Math.random() * 500) + 100;
      dailySales[nozzle.id].night = Math.floor(Math.random() * 500) + 100;
    });
  }

  // Generate dates: March 1 - April 2, 2026
  const startDate = new Date('2026-03-01T00:00:00Z');
  const endDate = new Date('2026-04-02T23:59:59Z');
  const dates: Date[] = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }

  console.log(`📅 Generating ${dates.length} days of data (${dates.length * 2} shifts, ${dates.length * 12} readings)\n`);

  let totalReadings = 0;

  for (const businessDate of dates) {
    const dateStr = businessDate.toISOString().split('T')[0];
    console.log(`📆 Processing ${dateStr}...`);

    // Day Shift (06:00 - 18:00)
    const dayShiftDate = new Date(businessDate);
    dayShiftDate.setHours(6, 0, 0, 0);

    // Check if shift instance exists
    let dayShiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        branchId: BRANCH_ID,
        shiftId: SHIFTS.day,
        shiftDate: businessDate,
      },
    });

    if (!dayShiftInstance) {
      dayShiftInstance = await prisma.shiftInstance.create({
        data: {
          id: `shift-day-${dateStr}`,
          branchId: BRANCH_ID,
          organizationId: ORG_ID,
          shiftId: SHIFTS.day,
          shiftDate: businessDate,
          startedAt: dayShiftDate,
          status: 'ended',
        },
      });
    }

    // Night Shift (18:00 - 06:00 next day)
    const nightShiftDate = new Date(businessDate);
    nightShiftDate.setHours(18, 0, 0, 0);

    let nightShiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        branchId: BRANCH_ID,
        shiftId: SHIFTS.night,
        shiftDate: businessDate,
      },
    });

    if (!nightShiftInstance) {
      nightShiftInstance = await prisma.shiftInstance.create({
        data: {
          id: `shift-night-${dateStr}`,
          branchId: BRANCH_ID,
          organizationId: ORG_ID,
          shiftId: SHIFTS.night,
          shiftDate: businessDate,
          startedAt: nightShiftDate,
          status: 'ended',
        },
      });
    }

    // Create meter readings for each nozzle
    for (const nozzle of NOZZLES) {
      // Day Shift
      const dayOpening = meterValues[nozzle.id];
      const daySales = Math.floor(Math.random() * 500) + 100; // 100-600L
      const dayClosing = dayOpening + daySales;

      await prisma.meterReading.createMany({
        data: [
          {
            id: `reading-day-open-${dateStr}-${nozzle.id}`,
            branchId: BRANCH_ID,
            organizationId: ORG_ID,
            shiftInstanceId: dayShiftInstance.id,
            dispenserId: nozzle.dispenser,
            nozzleId: nozzle.id,
            readingType: 'opening',
            meterValue: dayOpening,
            recordedBy: CASHIER_ID,
            recordedAt: new Date(dayShiftDate.getTime() + 10 * 60000), // 10 min after shift start
          },
          {
            id: `reading-day-close-${dateStr}-${nozzle.id}`,
            branchId: BRANCH_ID,
            organizationId: ORG_ID,
            shiftInstanceId: dayShiftInstance.id,
            dispenserId: nozzle.dispenser,
            nozzleId: nozzle.id,
            readingType: 'closing',
            meterValue: dayClosing,
            recordedBy: CASHIER_ID,
            recordedAt: new Date(dayShiftDate.getTime() + 11 * 3600000 + 50 * 60000), // 11h 50m later
          },
        ],
        skipDuplicates: true,
      });

      // Night Shift
      const nightOpening = dayClosing; // Chain from day shift
      const nightSales = Math.floor(Math.random() * 500) + 100;
      const nightClosing = nightOpening + nightSales;

      await prisma.meterReading.createMany({
        data: [
          {
            id: `reading-night-open-${dateStr}-${nozzle.id}`,
            branchId: BRANCH_ID,
            organizationId: ORG_ID,
            shiftInstanceId: nightShiftInstance.id,
            dispenserId: nozzle.dispenser,
            nozzleId: nozzle.id,
            readingType: 'opening',
            meterValue: nightOpening,
            recordedBy: CASHIER_ID,
            recordedAt: new Date(nightShiftDate.getTime() + 10 * 60000),
          },
          {
            id: `reading-night-close-${dateStr}-${nozzle.id}`,
            branchId: BRANCH_ID,
            organizationId: ORG_ID,
            shiftInstanceId: nightShiftInstance.id,
            dispenserId: nozzle.dispenser,
            nozzleId: nozzle.id,
            readingType: 'closing',
            meterValue: nightClosing,
            recordedBy: CASHIER_ID,
            recordedAt: new Date(nightShiftDate.getTime() + 11 * 3600000 + 50 * 60000),
          },
        ],
        skipDuplicates: true,
      });

      // Update running totals for next day
      meterValues[nozzle.id] = nightClosing;

      totalReadings += 4; // 2 day + 2 night
    }

    console.log(`  ✅ ${dateStr}: Day opening=${meterValues[NOZZLES[0].id] - daySales - dailySales[NOZZLES[0].id].night}, Night closing=${meterValues[NOZZLES[0].id]}`);
  }

  console.log(`\n✅ Seeding complete!`);
  console.log(`   Total days: ${dates.length}`);
  console.log(`   Total shifts: ${dates.length * 2}`);
  console.log(`   Total readings: ${totalReadings}`);
  console.log(`\n📊 Final meter values (should align with Apr 3 opening = 1000000):`);
  NOZZLES.forEach((nozzle) => {
    console.log(`   ${nozzle.name}: ${meterValues[nozzle.id].toLocaleString()}`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
