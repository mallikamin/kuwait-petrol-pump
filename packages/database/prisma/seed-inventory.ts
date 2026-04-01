import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extracted from inventory-list.xlsx rows 2-102
const INVENTORY_DATA = [
  // Fuel items
  { name: 'HSD', category: 'Fuel', costPrice: 278.91, unitPrice: 285.97 },
  { name: 'PMG', category: 'Fuel', costPrice: 259.92, unitPrice: 266.98 },

  // Non-fuel items
  { name: '2 Stroke Oil 1 Ltr', category: 'Non-Fuel', costPrice: 776.80, unitPrice: 850.00 },
  { name: 'AC TOYOTA GLI', category: 'Non-Fuel', costPrice: 350.00, unitPrice: 700.00 },
  { name: 'AIR FILTER GUARD 1050', category: 'Non-Fuel', costPrice: 420.00, unitPrice: 600.00 },
  { name: 'AIR FILTER GUARD 2022', category: 'Non-Fuel', costPrice: 440.84, unitPrice: 750.00 },
  { name: 'AIR FILTER GUARD 2042', category: 'Non-Fuel', costPrice: 385.00, unitPrice: 700.00 },
  { name: 'AIR FILTER GUARD 449', category: 'Non-Fuel', costPrice: 315.78, unitPrice: 460.00 },
  { name: 'ALTO AC FILTER', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 450.00 },
  { name: 'BLAZE 4T 1 LTR', category: 'Non-Fuel', costPrice: 892.00, unitPrice: 905.00 },
  { name: 'BLAZE 4T 700ml', category: 'Non-Fuel', costPrice: 656.79, unitPrice: 670.00 },
  { name: 'BLAZE XTREME 4T 01 LITTER', category: 'Non-Fuel', costPrice: 1052.00, unitPrice: 1100.00 },
  { name: 'BRAKE OIL GUARD Large', category: 'Non-Fuel', costPrice: 282.00, unitPrice: 290.00 },
  { name: 'CARIENT FULLY SYN 5W30 4 LTR', category: 'Non-Fuel', costPrice: 7260.08, unitPrice: 8000.00 },
  { name: 'CARIENT PLUS 20W-50 1LTR', category: 'Non-Fuel', costPrice: 1118.00, unitPrice: 1140.00 },
  { name: 'CARIENT PLUS 20W-50 3 LTR', category: 'Non-Fuel', costPrice: 3264.02, unitPrice: 3330.00 },
  { name: 'CARIENT PLUS 20W-50 4 LTR', category: 'Non-Fuel', costPrice: 4352.03, unitPrice: 4440.00 },
  { name: 'CARIENT PSO 5W 30 4 LTR', category: 'Non-Fuel', costPrice: 7633.00, unitPrice: 8600.00 },
  { name: 'Carient S PRO 5-W 30 4L', category: 'Non-Fuel', costPrice: 7632.00, unitPrice: 8600.00 },
  { name: 'CARIENT ULTRA 1 LTR', category: 'Non-Fuel', costPrice: 1401.00, unitPrice: 1450.00 },
  { name: 'CARIENT ULTRA 3 LTR', category: 'Non-Fuel', costPrice: 4113.00, unitPrice: 4250.00 },
  { name: 'CARIENT ULTRA SAE 4 LTR', category: 'Non-Fuel', costPrice: 5484.00, unitPrice: 5660.00 },
  { name: 'COASTER AIR FILTER', category: 'Non-Fuel', costPrice: 1087.50, unitPrice: 1800.00 },
  { name: 'COROLLA  AC FILTER', category: 'Non-Fuel', costPrice: 250.00, unitPrice: 300.00 },
  { name: 'CULTUS AC FILTER', category: 'Non-Fuel', costPrice: 180.00, unitPrice: 350.00 },
  { name: 'DEO 3000 SAE-50 10 LTR', category: 'Non-Fuel', costPrice: 8112.00, unitPrice: 9050.00 },
  { name: 'DEO 3000 SAE-50 4 LTR', category: 'Non-Fuel', costPrice: 3364.80, unitPrice: 3620.00 },
  { name: 'DEO 6000 20W-50 10 LTR', category: 'Non-Fuel', costPrice: 9724.08, unitPrice: 10500.00 },
  { name: 'DEO 6000 20W-50 4 LTR', category: 'Non-Fuel', costPrice: 4112.01, unitPrice: 4200.00 },
  { name: 'DEO 8000  SAE 15W-40 10 LTR', category: 'Non-Fuel', costPrice: 11692.00, unitPrice: 12000.00 },
  { name: 'DEO 8000  SAE 15W-40 4 LTR', category: 'Non-Fuel', costPrice: 4676.80, unitPrice: 4800.00 },
  { name: 'DEO 8000 1 LTR', category: 'Non-Fuel', costPrice: 1200.00, unitPrice: 1250.00 },
  { name: 'DEO MAX CK 4 LTR', category: 'Non-Fuel', costPrice: 5708.78, unitPrice: 6800.00 },
  { name: 'DG CARD', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 250.00 },
  { name: 'DIESEL FILTER GUARD 296', category: 'Non-Fuel', costPrice: 240.00, unitPrice: 370.00 },
  { name: 'DIESEL FILTER GUARD 796', category: 'Non-Fuel', costPrice: 476.66, unitPrice: 650.00 },
  { name: 'DIESEL LUBE HD-50 10 LTR', category: 'Non-Fuel', costPrice: 6612.04, unitPrice: 7150.00 },
  { name: 'DIESEL LUBE HD-50 4 LTR', category: 'Non-Fuel', costPrice: 2644.82, unitPrice: 2860.00 },
  { name: 'FILTER 0060', category: 'Non-Fuel', costPrice: 315.00, unitPrice: 530.00 },
  { name: 'FILTER 1010', category: 'Non-Fuel', costPrice: 520.00, unitPrice: 650.00 },
  { name: 'FILTER 116', category: 'Non-Fuel', costPrice: 260.00, unitPrice: 350.00 },
  { name: 'FILTER 158', category: 'Non-Fuel', costPrice: 330.00, unitPrice: 400.00 },
  { name: 'FILTER 197', category: 'Non-Fuel', costPrice: 400.00, unitPrice: 600.00 },
  { name: 'FILTER 2003', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 1050.00 },
  { name: 'FILTER 2027', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 700.00 },
  { name: 'FILTER 224', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 550.00 },
  { name: 'FILTER 501', category: 'Non-Fuel', costPrice: 480.00, unitPrice: 550.00 },
  { name: 'FILTER FOR AMBULANCE', category: 'Non-Fuel', costPrice: 1200.00, unitPrice: 2000.00 },
  { name: 'FILTER FOR LOADER RICKSHAW', category: 'Non-Fuel', costPrice: 160.00, unitPrice: 200.00 },
  { name: 'FILTER JALI FOAM BIKE 125', category: 'Non-Fuel', costPrice: 110.00, unitPrice: 150.00 },
  { name: 'FILTER P 407', category: 'Non-Fuel', costPrice: 750.00, unitPrice: 1000.00 },
  { name: 'FUEL FILTER 213', category: 'Non-Fuel', costPrice: 610.00, unitPrice: 800.00 },
  { name: 'FUEL FILTER 222', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 700.00 },
  { name: 'GEAR OIL EP-140 (GL 4) 1LTR', category: 'Non-Fuel', costPrice: 900.00, unitPrice: 1000.00 },
  { name: 'GEARTEC GEAR OIL  SAE 85W-140', category: 'Non-Fuel', costPrice: 997.24, unitPrice: 1050.00 },
  { name: 'GENERATOR OIL 1 LTR', category: 'Non-Fuel', costPrice: 788.00, unitPrice: 810.00 },
  { name: 'GUARD DIESEL FILTER 440', category: 'Non-Fuel', costPrice: 520.00, unitPrice: 700.00 },
  { name: 'GUARD FILTER 163', category: 'Non-Fuel', costPrice: 275.00, unitPrice: 550.00 },
  { name: 'GUARD FILTER 2056', category: 'Non-Fuel', costPrice: 710.00, unitPrice: 1000.00 },
  { name: 'GUARD OIL FILTER no. 151', category: 'Non-Fuel', costPrice: 352.00, unitPrice: 450.00 },
  { name: 'HIGH S NEW MODEL', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 650.00 },
  { name: 'HYDROLIC OIL', category: 'Non-Fuel', costPrice: 780.00, unitPrice: 850.00 },
  { name: 'MOTOR BIKE AIR FILTER', category: 'Non-Fuel', costPrice: 55.00, unitPrice: 100.00 },
  { name: 'MOTOR OIL 30740 SC/CC 210 LTR', category: 'Non-Fuel', costPrice: 493.56, unitPrice: 600.00 },
  { name: 'NEW XLI AC', category: 'Non-Fuel', costPrice: 190.00, unitPrice: 400.00 },
  { name: 'NPR OIL FILTER', category: 'Non-Fuel', costPrice: 900.00, unitPrice: 1200.00 },
  { name: 'OIL FILTER 161', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 1100.00 },
  { name: 'OIL FILTER 198', category: 'Non-Fuel', costPrice: 521.50, unitPrice: 650.00 },
  { name: 'OIL FILTER 2012', category: 'Non-Fuel', costPrice: 360.00, unitPrice: 650.00 },
  { name: 'OIL FILTER 333', category: 'Non-Fuel', costPrice: 700.00, unitPrice: 800.00 },
  { name: 'OIL FILTER GUARD 158', category: 'Non-Fuel', costPrice: 330.00, unitPrice: 460.00 },
  { name: 'OIL FILTER GUARD 506', category: 'Non-Fuel', costPrice: 612.00, unitPrice: 700.00 },
  { name: 'OIL FILTER GUARD no. 171', category: 'Non-Fuel', costPrice: 630.00, unitPrice: 700.00 },
  { name: 'OIL FILTER GUARD no. 501', category: 'Non-Fuel', costPrice: 485.00, unitPrice: 570.00 },
  { name: 'PREMIER MOTOR OIL 4 LTR', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 960.00 },
  { name: 'RIVO DALA DIESEL FILTER 070', category: 'Non-Fuel', costPrice: 750.00, unitPrice: 800.00 },
  { name: 'RIVO RICKSHAW AIR FILTER', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 1200.00 },
  { name: 'TOTOTA DIESEL FILTER LO 70', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 800.00 },
  { name: 'TOTOTA Hino Oil Filter', category: 'Non-Fuel', costPrice: 1064.29, unitPrice: 2100.00 },
  { name: 'VIGO AC FILTER', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 450.00 },
  { name: 'VIGO AIR FILTERS', category: 'Non-Fuel', costPrice: 950.00, unitPrice: 1200.00 },
  { name: 'VIGO DIESEL FILTER LARGE', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 650.00 },
  { name: 'VIGO DIESEL FILTERS', category: 'Non-Fuel', costPrice: 350.00, unitPrice: 700.00 },
  { name: 'WAGON AIR FILTER', category: 'Non-Fuel', costPrice: 250.00, unitPrice: 450.00 },
  { name: 'YARIS FILTER', category: 'Non-Fuel', costPrice: 470.00, unitPrice: 1000.00 },
];

async function seedInventory() {
  try {
    console.log('🚀 Starting inventory seed...\n');

    const organization = await prisma.organization.findFirst();
    if (!organization) {
      throw new Error('No organization found');
    }

    console.log(`✅ Organization: ${organization.name}\n`);

    let fuelCount = 0;
    let nonFuelCount = 0;
    let duplicateCount = 0;

    for (const item of INVENTORY_DATA) {
      const isFuel = item.category === 'Fuel';
      const prefix = isFuel ? 'FUEL' : 'NONFUEL';
      const counter = isFuel ? ++fuelCount : ++nonFuelCount;
      const sku = `${prefix}-${String(counter).padStart(3, '0')}`;

      try {
        await prisma.product.create({
          data: {
            organizationId: organization.id,
            sku,
            name: item.name,
            category: item.category,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice > 0 ? item.costPrice : null,
            isActive: true,
            lowStockThreshold: isFuel ? null : 10,
          },
        });
        console.log(`✅ ${sku}: ${item.name}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          duplicateCount++;
          console.log(`⚠️  SKIP: ${item.name} (duplicate)`);
        } else {
          console.error(`❌ ERROR: ${item.name} - ${error.message}`);
        }
      }
    }

    console.log(`\n✅ Imported ${fuelCount + nonFuelCount - duplicateCount} products`);
    console.log(`⚠️  Skipped ${duplicateCount} duplicates`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedInventory();
