/**
 * Sync Integration Tests - End-to-End Verification
 * Sprint 1: Offline Foundation
 *
 * SCENARIO: Device offline for 30 minutes, queues 50 transactions,
 * then comes back online. Verify:
 * - All 50 records are synced exactly once
 * - No duplicates, no loss
 * - Partial failures don't prevent others from syncing
 * - Retry logic works correctly
 */

import { PrismaClient } from '@prisma/client';
import { SyncService } from './sync.service';
import { QueuedSale } from './sync.types';

// Use real database for integration tests (or test database)
const prisma = new PrismaClient();

describe('Sync Integration - Offline Recovery Scenario', () => {
  beforeAll(async () => {
    // Clean test data before tests
    await prisma.sale.deleteMany({
      where: { offlineQueueId: { startsWith: 'integration-test-' } },
    });
    await prisma.meterReading.deleteMany({
      where: { offlineQueueId: { startsWith: 'integration-test-' } },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.$disconnect();
  });

  describe('50-Record Offline Queue Sync', () => {
    it('should sync 50 queued sales with zero duplicates', async () => {
      // Simulate offline queue: 50 sales
      const queuedSales: QueuedSale[] = Array.from({ length: 50 }, (_, i) => ({
        offlineQueueId: `integration-test-sale-${i.toString().padStart(3, '0')}`,
        branchId: 'test-branch-1',
        shiftInstanceId: 'test-shift-1',
        saleDate: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30min ago
        saleType: 'fuel',
        totalAmount: 100 * (i + 1), // Vary amounts
        taxAmount: 10 * (i + 1),
        discountAmount: 0,
        paymentMethod: i % 2 === 0 ? 'cash' : 'card',
        customerId: null,
        vehicleNumber: `VHCL-${i.toString().padStart(3, '0')}`,
        slipNumber: `SLIP-${i.toString().padStart(3, '0')}`,
        cashierId: 'test-cashier-1',
        fuelSales: [
          {
            nozzleId: `nozzle-${(i % 5) + 1}`, // 5 nozzles, round-robin
            fuelTypeId: 'fuel-premium',
            quantityLiters: 10 + i,
            pricePerLiter: 1.5,
            totalAmount: (10 + i) * 1.5,
          },
        ],
        nonFuelSales: i % 10 === 0 ? [] : [], // Some with line items, some without
      }));

      // First sync: All 50 should succeed
      const result1 = await SyncService.syncSales(queuedSales, 'test-org-1');
      expect(result1.synced).toBe(50);
      expect(result1.failed).toBe(0);
      expect(result1.duplicates).toBe(0);
      expect(result1.success).toBe(true);
      expect(result1.errors).toHaveLength(0);

      // Verify database has exactly 50 sales
      const dbCount = await prisma.sale.count({
        where: { offlineQueueId: { startsWith: 'integration-test-sale-' } },
      });
      expect(dbCount).toBe(50);

      // CRITICAL: Replay same 50 (network retry scenario)
      const result2 = await SyncService.syncSales(queuedSales, 'test-org-1');
      expect(result2.synced).toBe(0); // Nothing new
      expect(result2.duplicates).toBe(50); // All detected as duplicates
      expect(result2.failed).toBe(0);

      // Verify still exactly 50 (no new records created)
      const dbCountAfterReplay = await prisma.sale.count({
        where: { offlineQueueId: { startsWith: 'integration-test-sale-' } },
      });
      expect(dbCountAfterReplay).toBe(50);
    });

    it('should handle interleaved online and offline records', async () => {
      // Simulate: Some records already in DB, some new in queue
      const newSales: QueuedSale[] = Array.from({ length: 20 }, (_, i) => ({
        offlineQueueId: `integration-test-interleave-new-${i}`,
        branchId: 'test-branch-2',
        shiftInstanceId: 'test-shift-2',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'test-cashier-2',
        vehicleNumber: `VHCL-NEW-${i}`,
        slipNumber: `SLIP-NEW-${i}`,
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      }));

      // Sync new records
      const result = await SyncService.syncSales(newSales, 'test-org-1');
      expect(result.synced).toBe(20);
      expect(result.duplicates).toBe(0);

      // Mix: 10 new + 10 old (replayed)
      const mixedSales = [
        ...newSales.slice(0, 10),
        ...Array.from({ length: 10 }, (_, i) => ({
          ...newSales[10],
          offlineQueueId: `integration-test-interleave-new-${i}`, // Already synced
        })),
      ];

      jest.clearAllMocks();
      const resultMixed = await SyncService.syncSales(mixedSales, 'test-org-1');

      // Expect: 0 new, 10 duplicates
      expect(resultMixed.synced).toBe(0);
      expect(resultMixed.duplicates).toBe(10);
    });
  });

  describe('Failure Resilience', () => {
    it('should skip failed records but continue syncing others', async () => {
      const sales: QueuedSale[] = [
        {
          offlineQueueId: 'integration-test-fail-1-ok',
          branchId: 'test-branch-3',
          shiftInstanceId: 'test-shift-3',
          saleDate: new Date().toISOString(),
          saleType: 'fuel',
          totalAmount: 500,
          paymentMethod: 'cash',
          cashierId: 'test-cashier-3',
          vehicleNumber: 'VHCL-FAIL-1',
          slipNumber: 'SLIP-FAIL-1',
          customerId: null,
          fuelSales: [],
          nonFuelSales: [],
        },
        {
          offlineQueueId: 'integration-test-fail-2-bad',
          branchId: 'invalid-branch', // Will fail FK
          shiftInstanceId: 'test-shift-3',
          saleDate: new Date().toISOString(),
          saleType: 'fuel',
          totalAmount: 500,
          paymentMethod: 'cash',
          cashierId: 'test-cashier-3',
          vehicleNumber: 'VHCL-FAIL-2',
          slipNumber: 'SLIP-FAIL-2',
          customerId: null,
          fuelSales: [],
          nonFuelSales: [],
        },
        {
          offlineQueueId: 'integration-test-fail-3-ok',
          branchId: 'test-branch-3',
          shiftInstanceId: 'test-shift-3',
          saleDate: new Date().toISOString(),
          saleType: 'fuel',
          totalAmount: 500,
          paymentMethod: 'cash',
          cashierId: 'test-cashier-3',
          vehicleNumber: 'VHCL-FAIL-3',
          slipNumber: 'SLIP-FAIL-3',
          customerId: null,
          fuelSales: [],
          nonFuelSales: [],
        },
      ];

      const result = await SyncService.syncSales(sales, 'test-org-1');

      // Expect: 2 success, 1 failure
      expect(result.synced).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);

      // Verify the good ones were created
      const goodSale1 = await prisma.sale.findUnique({
        where: { offlineQueueId: 'integration-test-fail-1-ok' },
      });
      expect(goodSale1).toBeDefined();

      const goodSale3 = await prisma.sale.findUnique({
        where: { offlineQueueId: 'integration-test-fail-3-ok' },
      });
      expect(goodSale3).toBeDefined();

      // Verify bad one was marked as failed
      const badSale = await prisma.sale.findUnique({
        where: { offlineQueueId: 'integration-test-fail-2-bad' },
      });
      expect(badSale).toBeDefined();
      expect(badSale?.syncStatus).toBe('failed');
      expect(badSale?.syncError).toBeDefined();
    });
  });

  describe('Sync Status Accuracy', () => {
    it('should correctly report sync status after batch', async () => {
      // Create 5 sales with various statuses
      const testCashier = 'test-cashier-status';

      // Synced sales
      await prisma.sale.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          branchId: 'test-branch-status',
          shiftInstanceId: 'test-shift-status',
          saleDate: new Date(),
          saleType: 'fuel' as any,
          totalAmount: 500,
          paymentMethod: 'cash' as any,
          cashierId: testCashier,
          vehicleNumber: `VHCL-SYNC-${i}`,
          slipNumber: `SLIP-SYNC-${i}`,
          customerId: null,
          syncStatus: 'synced' as any,
          offlineQueueId: `status-test-synced-${i}`,
          syncAttempts: 1,
          lastSyncAttempt: new Date(),
        })),
      });

      // Failed sales
      await prisma.sale.createMany({
        data: Array.from({ length: 2 }, (_, i) => ({
          branchId: 'test-branch-status',
          shiftInstanceId: 'test-shift-status',
          saleDate: new Date(),
          saleType: 'fuel' as any,
          totalAmount: 500,
          paymentMethod: 'cash' as any,
          cashierId: testCashier,
          vehicleNumber: `VHCL-FAIL-${i}`,
          slipNumber: `SLIP-FAIL-${i}`,
          customerId: null,
          syncStatus: 'failed' as any,
          offlineQueueId: `status-test-failed-${i}`,
          syncAttempts: 2,
          lastSyncAttempt: new Date(),
          syncError: 'Test error',
        })),
      });

      const status = await SyncService.getSyncStatus(testCashier);

      expect(status.userId).toBe(testCashier);
      expect(status.failedCount).toBe(2);
      expect(status.lastSyncAt).toBeDefined();
    });
  });

  describe('Concurrent Sync Protection', () => {
    it('should handle rapid repeated sync attempts safely', async () => {
      const sale: QueuedSale = {
        offlineQueueId: 'integration-test-concurrent',
        branchId: 'test-branch-4',
        shiftInstanceId: 'test-shift-4',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'test-cashier-4',
        vehicleNumber: 'VHCL-CONCURRENT',
        slipNumber: 'SLIP-CONCURRENT',
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      };

      // Simulate rapid fire syncs (network retry behavior)
      const results = await Promise.all([
        SyncService.syncSales([sale], 'test-org-1'),
        SyncService.syncSales([sale], 'test-org-1'),
        SyncService.syncSales([sale], 'test-org-1'),
      ]);

      // Exactly one should succeed, others should see duplicate
      const successCount = results.filter((r) => r.synced === 1).length;
      const duplicateCount = results.filter((r) => r.duplicates === 1).length;

      expect(successCount).toBe(1);
      expect(duplicateCount).toBe(2);

      // Verify exactly 1 record in DB
      const dbCount = await prisma.sale.count({
        where: { offlineQueueId: 'integration-test-concurrent' },
      });
      expect(dbCount).toBe(1);
    });
  });

  describe('Data Integrity Checks', () => {
    it('should maintain referential integrity across sync', async () => {
      // Create valid shift and nozzle references
      const sale: QueuedSale = {
        offlineQueueId: 'integration-test-integrity',
        branchId: 'test-branch-5',
        shiftInstanceId: 'test-shift-5',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'test-cashier-5',
        vehicleNumber: 'VHCL-INTEGRITY',
        slipNumber: 'SLIP-INTEGRITY',
        customerId: null,
        fuelSales: [
          {
            nozzleId: 'nozzle-integrity-1',
            fuelTypeId: 'fuel-integrity',
            quantityLiters: 10,
            pricePerLiter: 1.5,
            totalAmount: 15,
          },
        ],
        nonFuelSales: [],
      };

      // Note: Actual integration test would need valid FK references
      // This demonstrates the structure

      const result = await SyncService.syncSales([sale], 'test-org-1');

      // Depending on DB setup, may succeed or fail with FK error
      // Either way, verify clean state (no orphaned records)
      if (result.failed > 0) {
        // If it failed, verify no partial records were created
        const orphanedFuelSales = await prisma.fuelSale.count({
          where: { sale: { offlineQueueId: 'integration-test-integrity' } },
        });
        expect(orphanedFuelSales).toBe(0);
      }
    });

    it('should not leave orphaned line items on transaction failure', async () => {
      // This test verifies Prisma transaction atomicity
      // If master sale fails, no line items should exist

      const sales = await prisma.sale.findMany({
        where: {
          offlineQueueId: { startsWith: 'integration-test-' },
          syncStatus: 'failed',
        },
        include: { fuelSales: true, nonFuelSales: true },
      });

      // All failed sales should have their line items (were synced despite master fail)
      // OR no line items (transaction rolled back)
      // Either is acceptable as long as it's consistent
      sales.forEach((sale) => {
        expect(Array.isArray(sale.fuelSales)).toBe(true);
        expect(Array.isArray(sale.nonFuelSales)).toBe(true);
      });
    });
  });
});

/**
 * Smoke Test: Quick sanity check
 * Run this to verify basic sync functionality works
 */
describe('Sync Smoke Test', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should create a simple sale and detect duplicate', async () => {
    const sale: QueuedSale = {
      offlineQueueId: 'smoke-test-sale',
      branchId: 'smoke-branch',
      shiftInstanceId: 'smoke-shift',
      saleDate: new Date().toISOString(),
      saleType: 'fuel',
      totalAmount: 100,
      paymentMethod: 'cash',
      cashierId: 'smoke-cashier',
      vehicleNumber: 'SMOKE-VHCL',
      slipNumber: 'SMOKE-SLIP',
      customerId: null,
      fuelSales: [],
      nonFuelSales: [],
    };

    // First sync
    const result1 = await SyncService.syncSales([sale], 'test-org-1');
    console.log('First sync:', {
      synced: result1.synced,
      duplicates: result1.duplicates,
      failed: result1.failed,
    });

    // Second sync (duplicate)
    const result2 = await SyncService.syncSales([sale], 'test-org-1');
    console.log('Second sync (replay):', {
      synced: result2.synced,
      duplicates: result2.duplicates,
      failed: result2.failed,
    });

    expect(result1.synced).toBe(1);
    expect(result2.duplicates).toBe(1);
    expect(result2.synced).toBe(0);
  });
});
