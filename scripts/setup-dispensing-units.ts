import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Sundar Estate Pump Configuration:
 *
 * Unit 1: 2 nozzles - PMG & HSD (Digital)
 * Unit 2: 1 nozzle  - HSD only (Digital)
 * Unit 3: 1 nozzle  - PMG only (Digital)
 * Unit 4: 2 nozzles - PMG & HSD (Digital)
 *
 * Total: 4 units, 6 nozzles
 */

async function setupDispensingUnits() {
  try {
    console.log('Setting up dispensing units...');

    // Get organization and branch
    const organization = await prisma.organization.findFirst();
    if (!organization) {
      throw new Error('No organization found. Please run seed first.');
    }

    const branch = await prisma.branch.findFirst({
      where: { organizationId: organization.id }
    });
    if (!branch) {
      throw new Error('No branch found. Please run seed first.');
    }

    // Get fuel types
    const pmg = await prisma.fuelType.findFirst({ where: { code: 'PMG' } });
    const hsd = await prisma.fuelType.findFirst({ where: { code: 'HSD' } });

    if (!pmg || !hsd) {
      throw new Error('Fuel types not found. Please run seed first.');
    }

    console.log(`Setting up for branch: ${branch.name}`);
    console.log(`PMG ID: ${pmg.id}, HSD ID: ${hsd.id}`);

    // Delete existing units and nozzles for this branch
    console.log('\nCleaning up existing units...');
    const existingUnits = await prisma.dispensingUnit.findMany({
      where: { branchId: branch.id },
      include: { nozzles: true }
    });

    for (const unit of existingUnits) {
      await prisma.nozzle.deleteMany({ where: { dispensingUnitId: unit.id } });
      await prisma.dispensingUnit.delete({ where: { id: unit.id } });
    }

    // Unit 1: 2 nozzles (PMG + HSD)
    console.log('\n📍 Creating Unit 1 (2 nozzles: PMG + HSD)');
    const unit1 = await prisma.dispensingUnit.create({
      data: {
        unitNumber: 1,
        name: 'Dispenser 1',
        branchId: branch.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 1,
        displayName: 'Unit 1 - Nozzle 1 (PMG)',
        fuelTypeId: pmg.id,
        dispensingUnitId: unit1.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 2,
        displayName: 'Unit 1 - Nozzle 2 (HSD)',
        fuelTypeId: hsd.id,
        dispensingUnitId: unit1.id,
        isActive: true,
      }
    });
    console.log('  ✅ Unit 1 created with 2 nozzles');

    // Unit 2: 1 nozzle (HSD only)
    console.log('\n📍 Creating Unit 2 (1 nozzle: HSD)');
    const unit2 = await prisma.dispensingUnit.create({
      data: {
        unitNumber: 2,
        name: 'Dispenser 2',
        branchId: branch.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 1,
        displayName: 'Unit 2 - Nozzle 1 (HSD)',
        fuelTypeId: hsd.id,
        dispensingUnitId: unit2.id,
        isActive: true,
      }
    });
    console.log('  ✅ Unit 2 created with 1 nozzle');

    // Unit 3: 1 nozzle (PMG only)
    console.log('\n📍 Creating Unit 3 (1 nozzle: PMG)');
    const unit3 = await prisma.dispensingUnit.create({
      data: {
        unitNumber: 3,
        name: 'Dispenser 3',
        branchId: branch.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 1,
        displayName: 'Unit 3 - Nozzle 1 (PMG)',
        fuelTypeId: pmg.id,
        dispensingUnitId: unit3.id,
        isActive: true,
      }
    });
    console.log('  ✅ Unit 3 created with 1 nozzle');

    // Unit 4: 2 nozzles (PMG + HSD)
    console.log('\n📍 Creating Unit 4 (2 nozzles: PMG + HSD)');
    const unit4 = await prisma.dispensingUnit.create({
      data: {
        unitNumber: 4,
        name: 'Dispenser 4',
        branchId: branch.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 1,
        displayName: 'Unit 4 - Nozzle 1 (PMG)',
        fuelTypeId: pmg.id,
        dispensingUnitId: unit4.id,
        isActive: true,
      }
    });

    await prisma.nozzle.create({
      data: {
        nozzleNumber: 2,
        displayName: 'Unit 4 - Nozzle 2 (HSD)',
        fuelTypeId: hsd.id,
        dispensingUnitId: unit4.id,
        isActive: true,
      }
    });
    console.log('  ✅ Unit 4 created with 2 nozzles');

    // Summary
    const totalUnits = await prisma.dispensingUnit.count({ where: { branchId: branch.id } });
    const totalNozzles = await prisma.nozzle.count({
      where: { dispensingUnit: { branchId: branch.id } }
    });

    console.log('\n✅ Setup complete!');
    console.log(`   Total Dispensing Units: ${totalUnits}`);
    console.log(`   Total Nozzles: ${totalNozzles}`);
    console.log('\n📋 Configuration:');
    console.log('   Unit 1: 2 nozzles (PMG + HSD) - Digital');
    console.log('   Unit 2: 1 nozzle  (HSD)       - Digital');
    console.log('   Unit 3: 1 nozzle  (PMG)       - Digital');
    console.log('   Unit 4: 2 nozzles (PMG + HSD) - Digital');

  } catch (error) {
    console.error('Error setting up dispensing units:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

setupDispensingUnits();
