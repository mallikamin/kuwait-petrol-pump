import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedShifts() {
  console.log('⏰ Seeding shifts...');

  // Get the first branch
  const branch = await prisma.branch.findFirst();

  if (!branch) {
    throw new Error('No branch found. Run quick-seed.ts first.');
  }

  // Check if shifts already exist
  const existingShifts = await prisma.shift.count({ where: { branchId: branch.id } });

  if (existingShifts > 0) {
    console.log(`✅ Shifts already exist (${existingShifts} shifts). Skipping.`);
    return;
  }

  // Create 3 shifts
  await prisma.shift.createMany({
    data: [
      {
        branchId: branch.id,
        shiftNumber: 1,
        name: 'Morning Shift',
        startTime: new Date('1970-01-01T06:00:00Z'),
        endTime: new Date('1970-01-01T14:00:00Z'),
        isActive: true,
      },
      {
        branchId: branch.id,
        shiftNumber: 2,
        name: 'Afternoon Shift',
        startTime: new Date('1970-01-01T14:00:00Z'),
        endTime: new Date('1970-01-01T22:00:00Z'),
        isActive: true,
      },
      {
        branchId: branch.id,
        shiftNumber: 3,
        name: 'Night Shift',
        startTime: new Date('1970-01-01T22:00:00Z'),
        endTime: new Date('1970-01-01T06:00:00Z'),
        isActive: true,
      },
    ],
  });

  console.log('✅ Created 3 shifts:');
  console.log('   - Morning: 6am-2pm');
  console.log('   - Afternoon: 2pm-10pm');
  console.log('   - Night: 10pm-6am');
}

seedShifts()
  .catch((e) => {
    console.error('❌ Shift seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
