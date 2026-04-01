import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const prisma = new PrismaClient();

interface InventoryRow {
  name: string;
  costPrice: number;
  unitPrice: number;
  category: 'Fuel' | 'Non-Fuel';
}

async function importInventory() {
  try {
    console.log('🚀 Starting inventory import...\n');

    // 1. Get organization ID
    const organization = await prisma.organization.findFirst();
    if (!organization) {
      throw new Error('No organization found in database. Please create an organization first.');
    }
    console.log(`✅ Using organization: ${organization.name} (${organization.id})\n`);

    // 2. Read Excel file
    const excelPath = path.join(__dirname, '../../../data/inventory-list.xlsx');
    console.log(`📖 Reading Excel file: ${excelPath}`);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log(`📊 Total rows in Excel: ${data.length}\n`);

    // 3. Extract and validate product data (rows 2-102)
    const products: InventoryRow[] = [];
    let skippedRows = 0;

    for (let i = 2; i < Math.min(data.length, 102); i++) {
      const row = data[i];
      const name = row[3]?.toString().trim(); // Column 3: Unnamed: 3
      const costPrice = parseFloat(row[4] || '0'); // Column 4: Calculated Avg
      const unitPrice = parseFloat(row[5] || '0'); // Column 5: Sales Price

      // Skip rows with missing or invalid data
      if (!name || name === '' || isNaN(unitPrice)) {
        skippedRows++;
        continue;
      }

      // Determine category based on product name
      const category = (name === 'HSD' || name === 'PMG') ? 'Fuel' : 'Non-Fuel';

      products.push({
        name,
        costPrice: isNaN(costPrice) ? 0 : costPrice,
        unitPrice,
        category,
      });
    }

    console.log(`✅ Extracted ${products.length} valid products`);
    console.log(`⚠️  Skipped ${skippedRows} invalid rows\n`);

    // 4. Group by category for SKU generation
    const fuelProducts = products.filter(p => p.category === 'Fuel');
    const nonFuelProducts = products.filter(p => p.category === 'Non-Fuel');

    console.log(`🔥 Fuel items: ${fuelProducts.length}`);
    console.log(`📦 Non-Fuel items: ${nonFuelProducts.length}\n`);

    // 5. Insert products into database
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    console.log('💾 Inserting products into database...\n');

    // Insert Fuel products
    for (let i = 0; i < fuelProducts.length; i++) {
      const product = fuelProducts[i];
      const sku = `FUEL-${String(i + 1).padStart(3, '0')}`;

      try {
        await prisma.product.create({
          data: {
            organizationId: organization.id,
            sku,
            name: product.name,
            category: product.category,
            unitPrice: product.unitPrice,
            costPrice: product.costPrice > 0 ? product.costPrice : null,
            isActive: true,
            lowStockThreshold: product.category === 'Fuel' ? null : 10, // Fuel doesn't have stock threshold
          },
        });
        successCount++;
        console.log(`✅ [${successCount}] ${sku}: ${product.name} - Rs ${product.unitPrice}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Unique constraint violation (duplicate SKU or org+sku combo)
          duplicateCount++;
          console.log(`⚠️  [SKIP] ${sku}: ${product.name} - Already exists`);
        } else {
          errorCount++;
          console.error(`❌ [ERROR] ${sku}: ${product.name} - ${error.message}`);
        }
      }
    }

    // Insert Non-Fuel products
    for (let i = 0; i < nonFuelProducts.length; i++) {
      const product = nonFuelProducts[i];
      const sku = `NONFUEL-${String(i + 1).padStart(3, '0')}`;

      try {
        await prisma.product.create({
          data: {
            organizationId: organization.id,
            sku,
            name: product.name,
            category: product.category,
            unitPrice: product.unitPrice,
            costPrice: product.costPrice > 0 ? product.costPrice : null,
            isActive: true,
            lowStockThreshold: 10,
          },
        });
        successCount++;
        console.log(`✅ [${successCount}] ${sku}: ${product.name} - Rs ${product.unitPrice}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          duplicateCount++;
          console.log(`⚠️  [SKIP] ${sku}: ${product.name} - Already exists`);
        } else {
          errorCount++;
          console.error(`❌ [ERROR] ${sku}: ${product.name} - ${error.message}`);
        }
      }
    }

    // 6. Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Successfully imported: ${successCount}`);
    console.log(`⚠️  Duplicates skipped: ${duplicateCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📦 Total processed: ${products.length}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importInventory()
  .then(() => {
    console.log('\n✅ Import completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  });
