/**
 * Create Backdated Entries for Testing
 *
 * Generates meter readings for past dates to test:
 * - Daily sales aggregation (meter readings → liters sold)
 * - Payment bifurcation (credit, PSO card, bank card, cash)
 * - Cash as reconciling figure
 *
 * Usage:
 *   npx ts-node src/scripts/create-backdated-entries.ts
 */

import { prisma } from '../config/database';
import { Decimal } from '@prisma/client/runtime/library';

interface BackdatedEntry {
  date: Date;
  nozzleId: string;
  nozzleName: string;
  fuelType: string;
  openingReading: number;
  closingReading: number;
  salesLiters: number;
  pricePerLiter: number;
  totalSalesAmount: number;
  creditCardSales: number;
  bankCardSales: number;
  psoCardSales: number;
  cashSales: number;
  notes: string;
}

// Realistic Pakistan fuel prices (PKR per liter) - Lahore deployment
const FUEL_PRICES = {
  PMG: 290.50, // Petrol (Pakistani Rupees per liter)
  HSD: 287.33, // Diesel (Pakistani Rupees per liter)
};

// Test nozzle IDs (from check-nozzles-prices.ts output)
const NOZZLES = {
  HSD_U1N1: '9dd85167-12f1-413c-8a48-f8612dfe2370', // Unit 1, Nozzle 1 (HSD)
  PMG_U1N2: '589b6b94-a0ec-4c4f-9425-9a5de0bd029a', // Unit 1, Nozzle 2 (PMG)
  HSD_U2N1: '404eff52-87d8-454b-871f-773e348c462c', // Unit 2, Nozzle 1 (HSD)
  PMG_U3N1: 'fd7d0bb0-7d73-4000-a8fc-bc4c90b32c6e', // Unit 3, Nozzle 1 (PMG)
};

// Generate test data for multiple dates
function generateBackdatedEntries(): BackdatedEntry[] {
  const entries: BackdatedEntry[] = [];
  const today = new Date();

  // Generate entries for past 7 days
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    date.setUTCHours(0, 0, 0, 0);

    // Base meter value starts high (7-digit minimum)
    const baseReading = 1000000 + (daysAgo * 1000);

    // Create entries for 2 HSD nozzles and 2 PMG nozzles per day
    const dailyEntries = [
      // HSD Nozzle 1 (Unit 1)
      {
        date,
        nozzleId: NOZZLES.HSD_U1N1,
        nozzleName: 'Unit 1 Nozzle 1 (HSD)',
        fuelType: 'HSD',
        openingReading: baseReading,
        closingReading: baseReading + 350, // 350 liters sold
        salesLiters: 350,
        pricePerLiter: FUEL_PRICES.HSD,
        totalSalesAmount: 350 * FUEL_PRICES.HSD, // ~100,566 PKR
        creditCardSales: 30000,
        bankCardSales: 25000,
        psoCardSales: 20000,
        cashSales: (350 * FUEL_PRICES.HSD) - 30000 - 25000 - 20000, // ~25,566 PKR
        notes: `Backdated entry for ${date.toISOString().split('T')[0]} - HSD Unit 1`,
      },
      // PMG Nozzle 1 (Unit 1)
      {
        date,
        nozzleId: NOZZLES.PMG_U1N2,
        nozzleName: 'Unit 1 Nozzle 2 (PMG)',
        fuelType: 'PMG',
        openingReading: baseReading + 500,
        closingReading: baseReading + 500 + 420, // 420 liters sold
        salesLiters: 420,
        pricePerLiter: FUEL_PRICES.PMG,
        totalSalesAmount: 420 * FUEL_PRICES.PMG, // ~122,010 PKR
        creditCardSales: 40000,
        bankCardSales: 35000,
        psoCardSales: 28000,
        cashSales: (420 * FUEL_PRICES.PMG) - 40000 - 35000 - 28000, // ~19,010 PKR
        notes: `Backdated entry for ${date.toISOString().split('T')[0]} - PMG Unit 1`,
      },
      // HSD Nozzle 2 (Unit 2)
      {
        date,
        nozzleId: NOZZLES.HSD_U2N1,
        nozzleName: 'Unit 2 Nozzle 1 (HSD)',
        fuelType: 'HSD',
        openingReading: baseReading + 1000,
        closingReading: baseReading + 1000 + 280, // 280 liters sold
        salesLiters: 280,
        pricePerLiter: FUEL_PRICES.HSD,
        totalSalesAmount: 280 * FUEL_PRICES.HSD, // ~80,452 PKR
        creditCardSales: 25000,
        bankCardSales: 18000,
        psoCardSales: 15000,
        cashSales: (280 * FUEL_PRICES.HSD) - 25000 - 18000 - 15000, // ~22,452 PKR
        notes: `Backdated entry for ${date.toISOString().split('T')[0]} - HSD Unit 2`,
      },
      // PMG Nozzle 2 (Unit 3)
      {
        date,
        nozzleId: NOZZLES.PMG_U3N1,
        nozzleName: 'Unit 3 Nozzle 1 (PMG)',
        fuelType: 'PMG',
        openingReading: baseReading + 1500,
        closingReading: baseReading + 1500 + 390, // 390 liters sold
        salesLiters: 390,
        pricePerLiter: FUEL_PRICES.PMG,
        totalSalesAmount: 390 * FUEL_PRICES.PMG, // ~113,295 PKR
        creditCardSales: 38000,
        bankCardSales: 32000,
        psoCardSales: 25000,
        cashSales: (390 * FUEL_PRICES.PMG) - 38000 - 32000 - 25000, // ~18,295 PKR
        notes: `Backdated entry for ${date.toISOString().split('T')[0]} - PMG Unit 3`,
      },
    ];

    entries.push(...dailyEntries);
  }

  return entries;
}

async function createBackdatedEntries() {
  console.log('🔄 Creating backdated entries for testing...\n');

  const entries = generateBackdatedEntries();

  console.log(`Generated ${entries.length} backdated entries for ${entries.length / 4} days\n`);

  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      // Check if entry already exists for this nozzle and date
      const existing = await prisma.$queryRaw<any[]>`
        SELECT id FROM backdated_entries
        WHERE nozzle_id = ${entry.nozzleId}::uuid
        AND date = ${entry.date}::date
        LIMIT 1
      `;

      if (existing.length > 0) {
        console.log(`⏭️  Skipping ${entry.date.toISOString().split('T')[0]} ${entry.nozzleName} (already exists)`);
        skipped++;
        continue;
      }

      // Create backdated entry
      await prisma.$executeRaw`
        INSERT INTO backdated_entries (
          id, date, nozzle_id,
          opening_reading, closing_reading,
          credit_card_sales, bank_card_sales, pso_card_sales,
          total_amount, notes,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${entry.date}::date,
          ${entry.nozzleId}::uuid,
          ${entry.openingReading}::decimal,
          ${entry.closingReading}::decimal,
          ${entry.creditCardSales}::decimal,
          ${entry.bankCardSales}::decimal,
          ${entry.psoCardSales}::decimal,
          ${entry.totalSalesAmount}::decimal,
          ${entry.notes},
          NOW(),
          NOW()
        )
      `;

      console.log(`✅ Created ${entry.date.toISOString().split('T')[0]} ${entry.nozzleName}`);
      console.log(`   Sales: ${entry.salesLiters}L × ${entry.pricePerLiter} = ${entry.totalSalesAmount.toFixed(2)} PKR`);
      console.log(`   Payment: Credit=${entry.creditCardSales} | Bank=${entry.bankCardSales} | PSO=${entry.psoCardSales} | Cash=${entry.cashSales.toFixed(2)} PKR\n`);

      created++;
    } catch (error: any) {
      console.error(`❌ Failed to create entry for ${entry.date.toISOString().split('T')[0]} ${entry.nozzleName}:`, error.message);
    }
  }

  console.log('\n📈 Summary:');
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${entries.length}\n`);

  // Show aggregated totals by fuel type per day
  console.log('📊 Daily Aggregates (for testing bifurcation):');
  const dates = [...new Set(entries.map(e => e.date.toISOString().split('T')[0]))].sort().reverse();

  for (const date of dates) {
    const dayEntries = entries.filter(e => e.date.toISOString().split('T')[0] === date);

    const hsdEntries = dayEntries.filter(e => e.fuelType === 'HSD');
    const pmgEntries = dayEntries.filter(e => e.fuelType === 'PMG');

    const hsdTotal = hsdEntries.reduce((sum, e) => sum + e.totalSalesAmount, 0);
    const pmgTotal = pmgEntries.reduce((sum, e) => sum + e.totalSalesAmount, 0);

    const hsdLiters = hsdEntries.reduce((sum, e) => sum + e.salesLiters, 0);
    const pmgLiters = pmgEntries.reduce((sum, e) => sum + e.salesLiters, 0);

    const totalCredit = dayEntries.reduce((sum, e) => sum + e.creditCardSales, 0);
    const totalBank = dayEntries.reduce((sum, e) => sum + e.bankCardSales, 0);
    const totalPSO = dayEntries.reduce((sum, e) => sum + e.psoCardSales, 0);
    const totalCash = dayEntries.reduce((sum, e) => sum + e.cashSales, 0);

    console.log(`\n  ${date}:`);
    console.log(`    HSD: ${hsdLiters}L = ${hsdTotal.toFixed(2)} PKR`);
    console.log(`    PMG: ${pmgLiters}L = ${pmgTotal.toFixed(2)} PKR`);
    console.log(`    Total: ${(hsdTotal + pmgTotal).toFixed(2)} PKR`);
    console.log(`    Bifurcation: Credit=${totalCredit} | Bank=${totalBank} | PSO=${totalPSO} | Cash=${totalCash.toFixed(2)}`);
  }

  console.log('\n✅ Backdated entries creation complete!');
}

// CLI execution
if (require.main === module) {
  createBackdatedEntries()
    .catch((error) => {
      console.error('\n❌ Failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { createBackdatedEntries, generateBackdatedEntries };
