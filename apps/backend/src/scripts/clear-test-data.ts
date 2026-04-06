/**
 * Clear Test Data Script
 *
 * Clears all transaction data while preserving master data:
 * - Clears: Sales, meter readings, shift instances, backdated entries, QB sync queue
 * - Preserves: Users, products, customers, nozzles, shifts (templates), banks, QB mappings
 *
 * Usage: npx ts-node src/scripts/clear-test-data.ts [--confirm]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const confirmFlag = args.includes('--confirm');

  if (!confirmFlag) {
    console.log('⚠️  DRY RUN MODE - No data will be deleted');
    console.log('   Run with --confirm to actually delete data\n');
  }

  try {
    // 1. Count records before deletion
    console.log('📊 Counting records to be deleted...\n');

    const counts = {
      backdatedTransactions: await prisma.backdatedTransaction.count(),
      backdatedEntries: await prisma.backdatedEntry.count(),
      bifurcations: await prisma.bifurcation.count(),
      nonFuelSales: await prisma.nonFuelSale.count(),
      fuelSales: await prisma.fuelSale.count(),
      sales: await prisma.sale.count(),
      meterReadings: await prisma.meterReading.count(),
      shiftInstances: await prisma.shiftInstance.count(),
      qbSyncQueue: await prisma.qBSyncQueue.count(),
      qbSyncLog: await prisma.qBSyncLog.count(),
      fuelInventoryTransactions: await prisma.fuelInventoryTransaction.count(),
    };

    console.log('Records to be deleted:');
    console.log('  - Backdated Transactions:', counts.backdatedTransactions);
    console.log('  - Backdated Entries:', counts.backdatedEntries);
    console.log('  - Bifurcations:', counts.bifurcations);
    console.log('  - Non-Fuel Sales:', counts.nonFuelSales);
    console.log('  - Fuel Sales:', counts.fuelSales);
    console.log('  - Sales:', counts.sales);
    console.log('  - Meter Readings:', counts.meterReadings);
    console.log('  - Shift Instances:', counts.shiftInstances);
    console.log('  - QB Sync Queue:', counts.qbSyncQueue);
    console.log('  - QB Sync Log:', counts.qbSyncLog);
    console.log('  - Fuel Inventory Transactions:', counts.fuelInventoryTransactions);
    console.log();

    // 2. Show preserved records
    const preserved = {
      organizations: await prisma.organization.count(),
      branches: await prisma.branch.count(),
      users: await prisma.user.count(),
      customers: await prisma.customer.count(),
      banks: await prisma.bank.count(),
      products: await prisma.product.count(),
      fuelTypes: await prisma.fuelType.count(),
      nozzles: await prisma.nozzle.count(),
      shifts: await prisma.shift.count(),
      qbConnections: await prisma.qBConnection.count(),
      qbEntityMappings: await prisma.qBEntityMapping.count(),
    };

    console.log('✅ Master data that will be PRESERVED:');
    console.log('  - Organizations:', preserved.organizations);
    console.log('  - Branches:', preserved.branches);
    console.log('  - Users:', preserved.users);
    console.log('  - Customers:', preserved.customers);
    console.log('  - Banks:', preserved.banks);
    console.log('  - Products:', preserved.products);
    console.log('  - Fuel Types:', preserved.fuelTypes);
    console.log('  - Nozzles:', preserved.nozzles);
    console.log('  - Shifts (templates):', preserved.shifts);
    console.log('  - QB Connections:', preserved.qbConnections);
    console.log('  - QB Entity Mappings:', preserved.qbEntityMappings);
    console.log();

    if (!confirmFlag) {
      console.log('⚠️  This was a DRY RUN - no data was deleted');
      console.log('   Run with --confirm to actually delete data');
      return;
    }

    // 3. Perform deletion in correct order (respecting foreign keys)
    console.log('🗑️  Starting deletion...\n');

    console.log('  Deleting backdated transactions...');
    const deletedBackdatedTxns = await prisma.backdatedTransaction.deleteMany({});
    console.log(`    ✓ Deleted ${deletedBackdatedTxns.count} backdated transactions`);

    console.log('  Deleting backdated entries...');
    const deletedBackdatedEntries = await prisma.backdatedEntry.deleteMany({});
    console.log(`    ✓ Deleted ${deletedBackdatedEntries.count} backdated entries`);

    console.log('  Deleting bifurcations...');
    const deletedBifurcations = await prisma.bifurcation.deleteMany({});
    console.log(`    ✓ Deleted ${deletedBifurcations.count} bifurcations`);

    console.log('  Deleting non-fuel sales...');
    const deletedNonFuelSales = await prisma.nonFuelSale.deleteMany({});
    console.log(`    ✓ Deleted ${deletedNonFuelSales.count} non-fuel sales`);

    console.log('  Deleting fuel sales...');
    const deletedFuelSales = await prisma.fuelSale.deleteMany({});
    console.log(`    ✓ Deleted ${deletedFuelSales.count} fuel sales`);

    console.log('  Deleting sales...');
    const deletedSales = await prisma.sale.deleteMany({});
    console.log(`    ✓ Deleted ${deletedSales.count} sales`);

    console.log('  Deleting meter readings...');
    const deletedMeterReadings = await prisma.meterReading.deleteMany({});
    console.log(`    ✓ Deleted ${deletedMeterReadings.count} meter readings`);

    console.log('  Deleting shift instances...');
    const deletedShiftInstances = await prisma.shiftInstance.deleteMany({});
    console.log(`    ✓ Deleted ${deletedShiftInstances.count} shift instances`);

    console.log('  Deleting QB sync queue...');
    const deletedQBQueue = await prisma.qBSyncQueue.deleteMany({});
    console.log(`    ✓ Deleted ${deletedQBQueue.count} QB queue items`);

    console.log('  Deleting QB sync log...');
    const deletedQBLog = await prisma.qBSyncLog.deleteMany({});
    console.log(`    ✓ Deleted ${deletedQBLog.count} QB log entries`);

    console.log('  Deleting fuel inventory transactions...');
    const deletedFuelInvTxns = await prisma.fuelInventoryTransaction.deleteMany({});
    console.log(`    ✓ Deleted ${deletedFuelInvTxns.count} fuel inventory transactions`);

    // 4. Reset fuel inventory current stock to 0
    console.log('  Resetting fuel inventory levels...');
    const updatedInventory = await prisma.fuelInventory.updateMany({
      data: {
        currentStock: 0,
        avgCostPerLiter: 0,
        lastReceiptDate: null,
      },
    });
    console.log(`    ✓ Reset ${updatedInventory.count} fuel inventory records`);

    console.log();
    console.log('✅ Test data cleared successfully!');
    console.log();
    console.log('Summary:');
    console.log(`  - Total transaction records deleted: ${
      deletedBackdatedTxns.count +
      deletedBackdatedEntries.count +
      deletedBifurcations.count +
      deletedNonFuelSales.count +
      deletedFuelSales.count +
      deletedSales.count +
      deletedMeterReadings.count +
      deletedShiftInstances.count +
      deletedQBQueue.count +
      deletedQBLog.count +
      deletedFuelInvTxns.count
    }`);
    console.log('  - Master data preserved (users, products, customers, nozzles, etc.)');
    console.log();

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
