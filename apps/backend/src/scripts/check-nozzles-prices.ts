import { prisma } from '../config/database';

async function checkData() {
  const branches = await prisma.branch.findMany({
    include: {
      dispensingUnits: {
        include: {
          nozzles: {
            include: {
              fuelType: true
            }
          }
        }
      }
    }
  });

  console.log('=== NOZZLES ===');
  for (const branch of branches) {
    console.log(`Branch: ${branch.name}`);
    for (const unit of branch.dispensingUnits) {
      console.log(`  Unit ${unit.unitNumber}: ${unit.name}`);
      for (const nozzle of unit.nozzles) {
        console.log(`    Nozzle ${nozzle.nozzleNumber}: ${nozzle.name || 'No name'} - ${nozzle.fuelType.code} (${nozzle.id})`);
      }
    }
  }

  console.log('\n=== FUEL PRICES ===');
  const prices = await prisma.fuelPrice.findMany({
    where: {
      effectiveTo: null
    },
    include: {
      fuelType: true
    }
  });

  for (const price of prices) {
    console.log(`${price.fuelType.code}: ${price.pricePerLiter} PKR/L (effective from ${price.effectiveFrom})`);
  }

  await prisma.$disconnect();
}

checkData();
