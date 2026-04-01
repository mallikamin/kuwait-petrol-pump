import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createDemoData() {
  console.log('🌱 Creating demo data...');

  // Get organization and branch
  const org = await prisma.organization.findFirst();
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id } });

  if (!org || !branch) {
    throw new Error('Organization or branch not found. Run quick-seed.ts first.');
  }

  // 1. Create Fuel Types
  console.log('\n📍 Creating fuel types...');
  const pmg = await prisma.fuelType.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      code: 'PMG',
      name: 'Petrol (Premium)',
      unit: 'liters',
    },
    update: {},
  });

  const hsd = await prisma.fuelType.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      code: 'HSD',
      name: 'Diesel (High Speed)',
      unit: 'liters',
    },
    update: {},
  });

  console.log('✅ Created fuel types: PMG, HSD');

  // 2. Create Fuel Prices
  console.log('\n💰 Creating fuel prices...');
  await prisma.fuelPrice.createMany({
    data: [
      {
        fuelTypeId: pmg.id,
        pricePerLiter: 321.17,
        effectiveFrom: new Date('2026-03-01'),
        notes: 'Initial price from requirements',
      },
      {
        fuelTypeId: hsd.id,
        pricePerLiter: 335.86,
        effectiveFrom: new Date('2026-03-01'),
        notes: 'Initial price from requirements',
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Created fuel prices: PMG=321.17, HSD=335.86');

  // 3. Create Dispensing Units with Nozzles (2-1-1-2 configuration)
  console.log('\n⛽ Creating dispensing units + nozzles...');

  const unit1 = await prisma.dispensingUnit.create({
    data: {
      branchId: branch.id,
      unitNumber: 1,
      name: 'Unit 1',
      nozzles: {
        create: [
          { nozzleNumber: 1, fuelTypeId: hsd.id },
          { nozzleNumber: 2, fuelTypeId: pmg.id },
        ],
      },
    },
  });

  const unit2 = await prisma.dispensingUnit.create({
    data: {
      branchId: branch.id,
      unitNumber: 2,
      name: 'Unit 2',
      nozzles: {
        create: [{ nozzleNumber: 1, fuelTypeId: hsd.id }],
      },
    },
  });

  const unit3 = await prisma.dispensingUnit.create({
    data: {
      branchId: branch.id,
      unitNumber: 3,
      name: 'Unit 3',
      nozzles: {
        create: [{ nozzleNumber: 1, fuelTypeId: pmg.id }],
      },
    },
  });

  const unit4 = await prisma.dispensingUnit.create({
    data: {
      branchId: branch.id,
      unitNumber: 4,
      name: 'Unit 4',
      nozzles: {
        create: [
          { nozzleNumber: 1, fuelTypeId: pmg.id },
          { nozzleNumber: 2, fuelTypeId: pmg.id },
        ],
      },
    },
  });

  console.log('✅ Created 4 dispensing units with 6 nozzles (2-1-1-2 config)');

  // 4. Create Sample Customers
  console.log('\n👥 Creating sample customers...');
  await prisma.customer.createMany({
    data: [
      {
        organizationId: org.id,
        name: 'XYZ Transport Company',
        phone: '+965 9876 5432',
        email: 'xyz@transport.com',
        vehicleNumbers: ['ABC-1234', 'ABC-1235'],
        creditLimit: 50000,
        creditDays: 30,
      },
      {
        organizationId: org.id,
        name: 'ABC Logistics',
        phone: '+965 8765 4321',
        email: 'abc@logistics.com',
        vehicleNumbers: ['DEF-5678'],
        creditLimit: 30000,
        creditDays: 15,
      },
      {
        organizationId: org.id,
        name: 'Quick Delivery Services',
        phone: '+965 7654 3210',
        email: 'quick@delivery.com',
        vehicleNumbers: ['GHI-9012', 'GHI-9013', 'GHI-9014'],
        creditLimit: 20000,
        creditDays: 30,
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Created 3 sample customers');

  // 5. Create Shifts (3 shifts: Morning, Afternoon, Night)
  console.log('\n⏰ Creating shifts...');
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
    skipDuplicates: true,
  });

  console.log('✅ Created 3 shifts: Morning (6am-2pm), Afternoon (2pm-10pm), Night (10pm-6am)');

  console.log('\n🎉 Demo data creation completed!\n');
  console.log('Summary:');
  console.log('- Fuel Types: 2 (PMG, HSD)');
  console.log('- Fuel Prices: 2 (current prices)');
  console.log('- Dispensing Units: 4');
  console.log('- Nozzles: 6 (2-1-1-2 configuration)');
  console.log('- Shifts: 3 (Morning, Afternoon, Night)');
  console.log('- Customers: 3 (credit customers)');
  console.log('- Products: 79 (imported by Codex)');
}

createDemoData()
  .catch((e) => {
    console.error('❌ Demo data creation failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
