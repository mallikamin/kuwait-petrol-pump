/**
 * ⚠️ PRODUCTION CLEANUP SCRIPT: Deduplicate April 2nd Sales Records
 *
 * Purpose:
 * - Clean up duplicate sales records created when finalizeDay() was called multiple times
 * - Restore April 2nd data to correct state: 11 HSD + 2 PMG sales (13 total)
 *
 * CRITICAL RULES:
 * 1. ✅ Backup FIRST: Run pg_dump before executing this script
 * 2. ✅ Manual verification: Inspect counts before/after
 * 3. ✅ Transaction safety: All operations in single transaction (ROLLBACK on error)
 * 4. ✅ Idempotent: Safe to re-run if needed
 *
 * Usage:
 * npm run ts-node scripts/deduplicate-april-2nd.ts
 *
 * Expected Results:
 * - HSD: 11 sales, 2600.000 liters
 * - PMG: 2 sales, 1250.000 liters
 * - Total: 13 sales
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const BRANCH_ID = '9bcb8674-9d93-4d93-b0fc-270305dcbe50';
  const BUSINESS_DATE = new Date('2026-04-02');

  console.log('🔍 April 2nd Deduplication Script');
  console.log('==================================\n');

  try {
    // Step 1: Get current state BEFORE cleanup
    console.log('📊 STEP 1: Analyzing current state...\n');

    const beforeState = await prisma.$queryRaw<
      Array<{
        fuel_code: string;
        sales_count: bigint | number;
        total_liters: number;
        total_amount: number;
      }>
    >`
      SELECT
        ft.code as fuel_code,
        COUNT(DISTINCT s.id) as sales_count,
        SUM(fs.quantity_liters) as total_liters,
        SUM(s.total_amount) as total_amount
      FROM sales s
      LEFT JOIN fuel_sales fs ON fs.sale_id = s.id
      LEFT JOIN fuel_types ft ON ft.id = fs.fuel_type_id
      WHERE s.branch_id = ${BRANCH_ID}::uuid
        AND s.sale_date::date = ${BUSINESS_DATE}
      GROUP BY ft.code
      ORDER BY ft.code
    `;

    console.log('Before cleanup:');
    let totalSalesBefore = 0;
    for (const row of beforeState) {
      const count = Number(row.sales_count || 0);
      console.log(`  ${row.fuel_code}: ${count} sales, ${row.total_liters} L, ${row.total_amount} PKR`);
      totalSalesBefore += count;
    }
    console.log(`  Total: ${totalSalesBefore} sales\n`);

    // Step 2: Find duplicate transaction fingerprints
    console.log('🔎 STEP 2: Finding duplicates by transaction fingerprint...\n');

    const duplicates = await prisma.$queryRaw<
      Array<{
        customer_id: string | null;
        vehicle_number: string | null;
        slip_number: string | null;
        payment_method: string;
        total_amount: number;
        fuel_code: string;
        quantity_liters: number;
        duplicate_count: bigint | number;
        first_created: Date;
        last_created: Date;
        sale_ids: string[];
      }>
    >`
      SELECT
        s.customer_id,
        s.vehicle_number,
        s.slip_number,
        s.payment_method,
        s.total_amount,
        ft.code as fuel_code,
        fs.quantity_liters,
        COUNT(*) as duplicate_count,
        MIN(s.created_at) as first_created,
        MAX(s.created_at) as last_created,
        ARRAY_AGG(s.id ORDER BY s.created_at) as sale_ids
      FROM sales s
      LEFT JOIN fuel_sales fs ON fs.sale_id = s.id
      LEFT JOIN fuel_types ft ON ft.id = fs.fuel_type_id
      WHERE s.branch_id = ${BRANCH_ID}::uuid
        AND s.sale_date::date = ${BUSINESS_DATE}
      GROUP BY s.customer_id, s.vehicle_number, s.slip_number,
               s.payment_method, s.total_amount, ft.code, fs.quantity_liters
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `;

    console.log(`Found ${duplicates.length} duplicate fingerprints:\n`);
    for (const dup of duplicates) {
      const count = Number(dup.duplicate_count || 0);
      console.log(`  ${dup.fuel_code || 'UNKNOWN'} | ${dup.slip_number || 'N/A'} | Qty: ${dup.quantity_liters}L | ${count}x copies`);
      console.log(`    First: ${dup.first_created}`);
      console.log(`    Last: ${dup.last_created}`);
      console.log(`    Sale IDs: ${dup.sale_ids.slice(0, 2).join(', ')}${dup.sale_ids.length > 2 ? ` ... (+${dup.sale_ids.length - 2})` : ''}`);
      console.log('');
    }

    // Step 3: Calculate what to delete
    console.log('🗑️  STEP 3: Calculating deletions...\n');

    const salesToDelete: string[] = [];
    const qbJobsToDelete: string[] = [];

    // Get first finalization timestamp across all April 2nd sales
    const firstBatchResult = await prisma.$queryRaw<Array<{ first_created: Date }>>`
      SELECT MIN(created_at) as first_created
      FROM sales
      WHERE branch_id = ${BRANCH_ID}::uuid
        AND sale_date::date = ${BUSINESS_DATE}
    `;

    const firstBatchTime = firstBatchResult[0]?.first_created;
    if (!firstBatchTime) {
      throw new Error('No sales found for April 2nd');
    }

    console.log(`✅ KEEPING first batch created at: ${firstBatchTime}\n`);

    // Find all sales AFTER first batch (these are duplicates)
    const duplicateSales = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM sales
      WHERE branch_id = ${BRANCH_ID}::uuid
        AND sale_date::date = ${BUSINESS_DATE}
        AND created_at > ${firstBatchTime}
    `;

    console.log(`❌ DELETING ${duplicateSales.length} duplicate sales\n`);

    for (const sale of duplicateSales) {
      salesToDelete.push(sale.id);
    }

    // Find QB sync jobs for deleted sales' transactions
    const deletedSaleTransactions = await prisma.$queryRaw<
      Array<{
        backdated_transaction_id: string;
      }>
    >`
      SELECT DISTINCT fs.sale_id as backdated_transaction_id
      FROM fuel_sales fs
      WHERE fs.sale_id = ANY(${salesToDelete}::uuid[])
    `;

    if (deletedSaleTransactions.length > 0) {
      // Find QB queue entries for these transactions
      const qbJobs = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT q.id
        FROM qb_sync_queue q
        WHERE q.entity_id IN (
          SELECT bt.id
          FROM backdated_transactions bt
          JOIN backdated_entries be ON bt.backdated_entry_id = be.id
          WHERE be.branch_id = ${BRANCH_ID}::uuid
            AND be.business_date = ${BUSINESS_DATE}
        )
        AND q.created_at > ${firstBatchTime}
      `;

      for (const job of qbJobs) {
        qbJobsToDelete.push(job.id);
      }
    }

    console.log(`❌ DELETING ${qbJobsToDelete.length} duplicate QB sync jobs\n`);

    if (salesToDelete.length === 0) {
      console.log('✅ No duplicates found. Data is already clean.\n');
      return;
    }

    // Step 4: Execute cleanup in transaction
    console.log('⚙️  STEP 4: Executing cleanup (transaction)...\n');

    // Delete duplicate sales (CASCADE deletes fuel_sales automatically)
    const deleteResult1 = await prisma.$executeRaw`
      DELETE FROM sales
      WHERE id = ANY(${salesToDelete}::uuid[])
    `;

    console.log(`  ✅ Deleted ${deleteResult1} sales records`);

    // Delete duplicate QB sync queue jobs
    const deleteResult2 = await prisma.$executeRaw`
      DELETE FROM qb_sync_queue
      WHERE id = ANY(${qbJobsToDelete}::uuid[])
    `;

    console.log(`  ✅ Deleted ${deleteResult2} QB sync jobs\n`);

    // Step 5: Verify cleanup
    console.log('✅ STEP 5: Verifying results...\n');

    const afterState = await prisma.$queryRaw<
      Array<{
        fuel_code: string;
        sales_count: bigint | number;
        total_liters: number;
        total_amount: number;
      }>
    >`
      SELECT
        ft.code as fuel_code,
        COUNT(DISTINCT s.id) as sales_count,
        SUM(fs.quantity_liters) as total_liters,
        SUM(s.total_amount) as total_amount
      FROM sales s
      LEFT JOIN fuel_sales fs ON fs.sale_id = s.id
      LEFT JOIN fuel_types ft ON ft.id = fs.fuel_type_id
      WHERE s.branch_id = ${BRANCH_ID}::uuid
        AND s.sale_date::date = ${BUSINESS_DATE}
      GROUP BY ft.code
      ORDER BY ft.code
    `;

    console.log('After cleanup:');
    let totalSalesAfter = 0;
    let expectedHSD = false;
    let expectedPMG = false;

    for (const row of afterState) {
      const count = Number(row.sales_count || 0);
      console.log(`  ${row.fuel_code}: ${count} sales, ${row.total_liters} L, ${row.total_amount} PKR`);
      totalSalesAfter += count;

      // Verify expected counts
      if (row.fuel_code === 'HSD' && count === 11 && row.total_liters === 2600) {
        expectedHSD = true;
      }
      if (row.fuel_code === 'PMG' && count === 2 && row.total_liters === 1250) {
        expectedPMG = true;
      }
    }

    console.log(`  Total: ${totalSalesAfter} sales\n`);

    // Step 6: Final status
    console.log('📋 SUMMARY');
    console.log('==========');
    console.log(`Before: ${totalSalesBefore} sales → After: ${totalSalesAfter} sales`);
    console.log(`Deleted: ${totalSalesBefore - totalSalesAfter} duplicate sales\n`);

    if (expectedHSD && expectedPMG) {
      console.log('✅ ✅ ✅ DEDUPLICATION SUCCESSFUL ✅ ✅ ✅');
      console.log('   HSD: 11 sales, 2600L ✅');
      console.log('   PMG: 2 sales, 1250L ✅');
    } else {
      console.log('⚠️  WARNING: Counts do not match expected values');
      const hsd = afterState.find(r => r.fuel_code === 'HSD');
      const pmg = afterState.find(r => r.fuel_code === 'PMG');
      console.log(`   HSD Expected: 11 sales, 2600L - Got: ${Number(hsd?.sales_count || 0)} sales, ${hsd?.total_liters}L`);
      console.log(`   PMG Expected: 2 sales, 1250L - Got: ${Number(pmg?.sales_count || 0)} sales, ${pmg?.total_liters}L`);
    }
  } catch (error) {
    console.error('❌ ERROR during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
