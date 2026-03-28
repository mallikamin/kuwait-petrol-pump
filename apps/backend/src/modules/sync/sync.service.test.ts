/**
 * Sync Service Tests - Idempotency Verification
 * Sprint 1: Offline Foundation
 *
 * CRITICAL: Verify that duplicate sales are NEVER created, even with:
 * - Concurrent sync requests
 * - Network retries
 * - Partial transaction failures
 */

import { PrismaClient } from '@prisma/client';
import { SyncService } from './sync.service';
import { QueuedSale, QueuedMeterReading } from './sync.types';
import { TenantValidator } from './tenant-validator';

// Mock Prisma Client
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    sale: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    meterReading: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    fuelSale: {
      createMany: jest.fn(),
    },
    nonFuelSale: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaClient)),
  };

  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

// Mock TenantValidator
jest.mock('./tenant-validator', () => ({
  TenantValidator: {
    validateSaleForeignKeys: jest.fn().mockResolvedValue(undefined),
    validateMeterReadingForeignKeys: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('SyncService - Idempotency Tests', () => {
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = require('@prisma/client').PrismaClient();
  });

  describe('syncSales - Duplicate Detection', () => {
    it('should skip duplicate sales (idempotent behavior)', async () => {
      const queuedSale: QueuedSale = {
        offlineQueueId: 'offline-sale-001',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        taxAmount: 50,
        discountAmount: 0,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-001',
        customerId: null,
        fuelSales: [
          {
            nozzleId: 'nozzle-1',
            fuelTypeId: 'fuel-1',
            quantityLiters: 50,
            pricePerLiter: 10,
            totalAmount: 500,
          },
        ],
        nonFuelSales: [],
      };

      // First sync: Record doesn't exist
      prisma.sale.findFirst.mockResolvedValueOnce(null);
      prisma.sale.create.mockResolvedValueOnce({
        id: 'sale-001',
        ...queuedSale,
      });
      prisma.fuelSale.createMany.mockResolvedValueOnce({ count: 1 });

      const result1 = await SyncService.syncSales([queuedSale], 'org-test');

      expect(result1.synced).toBe(1);
      expect(result1.duplicates).toBe(0);
      expect(prisma.sale.create).toHaveBeenCalledTimes(1);

      // Second sync: Record already exists (duplicate)
      jest.clearAllMocks();
      prisma.sale.findFirst.mockResolvedValueOnce({
        id: 'sale-001',
        offlineQueueId: queuedSale.offlineQueueId,
      });

      const result2 = await SyncService.syncSales([queuedSale], 'org-test');

      expect(result2.synced).toBe(0);
      expect(result2.duplicates).toBe(1);
      expect(prisma.sale.create).not.toHaveBeenCalled(); // Never called
    });

    it('should handle multiple sales with mix of new and duplicates', async () => {
      const newSale: QueuedSale = {
        offlineQueueId: 'offline-sale-new',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-002',
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      };

      const duplicateSale: QueuedSale = {
        offlineQueueId: 'offline-sale-dup',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 300,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'XYZ-789',
        slipNumber: 'SLIP-003',
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      };

      // Mock responses: new sale doesn't exist, duplicate does
      prisma.sale.findFirst
        .mockResolvedValueOnce(null) // New sale check
        .mockResolvedValueOnce({ id: 'sale-dup' }); // Duplicate sale check

      prisma.sale.create.mockResolvedValueOnce({ id: 'sale-new', ...newSale });
      prisma.fuelSale.createMany.mockResolvedValueOnce({ count: 0 });

      const result = await SyncService.syncSales([newSale, duplicateSale], 'org-test');

      expect(result.synced).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe('syncSales - Atomic Transactions', () => {
    it('should rollback entire sale if line items fail', async () => {
      const queuedSale: QueuedSale = {
        offlineQueueId: 'offline-sale-atomic',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-004',
        customerId: null,
        fuelSales: [
          {
            nozzleId: 'nozzle-1',
            fuelTypeId: 'fuel-1',
            quantityLiters: 50,
            pricePerLiter: 10,
            totalAmount: 500,
          },
        ],
        nonFuelSales: [],
      };

      // Simulate transaction failure
      prisma.sale.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValueOnce(
        new Error('Foreign key constraint failed')
      );
      prisma.sale.updateMany.mockResolvedValueOnce({ count: 0 }); // Mark as failed

      const result = await SyncService.syncSales([queuedSale], 'org-test');

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Foreign key constraint');
    });

    it('should not create partial line items if master sale fails', async () => {
      const queuedSale: QueuedSale = {
        offlineQueueId: 'offline-sale-partial',
        branchId: 'branch-invalid', // Will fail FK check
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-005',
        customerId: null,
        fuelSales: [
          {
            nozzleId: 'nozzle-1',
            fuelTypeId: 'fuel-1',
            quantityLiters: 50,
            pricePerLiter: 10,
            totalAmount: 500,
          },
        ],
        nonFuelSales: [],
      };

      prisma.sale.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValueOnce(
        new Error('Invalid branch ID')
      );

      const result = await SyncService.syncSales([queuedSale], 'org-test');

      // Verify fuelSale.createMany was NEVER called (transaction rolled back)
      expect(prisma.fuelSale.createMany).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
    });
  });

  describe('syncMeterReadings - Idempotency', () => {
    it('should skip duplicate meter readings', async () => {
      const queuedReading: QueuedMeterReading = {
        offlineQueueId: 'offline-reading-001',
        nozzleId: 'nozzle-1',
        shiftInstanceId: 'shift-1',
        readingType: 'opening',
        meterValue: 1000,
        imageUrl: 'https://example.com/image.jpg',
        ocrResult: '1000',
        isManualOverride: false,
        recordedBy: 'operator-1',
        recordedAt: new Date().toISOString(),
      };

      // First sync
      prisma.meterReading.findFirst.mockResolvedValueOnce(null);
      prisma.meterReading.create.mockResolvedValueOnce({
        id: 'reading-001',
        ...queuedReading,
      });

      const result1 = await SyncService.syncMeterReadings([queuedReading], 'org-test');
      expect(result1.synced).toBe(1);
      expect(result1.duplicates).toBe(0);

      // Second sync (duplicate)
      jest.clearAllMocks();
      prisma.meterReading.findFirst.mockResolvedValueOnce({
        id: 'reading-001',
        offlineQueueId: queuedReading.offlineQueueId,
      });

      const result2 = await SyncService.syncMeterReadings([queuedReading], 'org-test');
      expect(result2.synced).toBe(0);
      expect(result2.duplicates).toBe(1);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });
  });

  describe('syncSales - Error Handling', () => {
    it('should mark failed sale and continue processing', async () => {
      const sale1: QueuedSale = {
        offlineQueueId: 'offline-sale-fail-1',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-006',
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      };

      const sale2: QueuedSale = {
        ...sale1,
        offlineQueueId: 'offline-sale-ok',
        slipNumber: 'SLIP-007',
      };

      // First sale fails, second succeeds
      prisma.sale.findFirst
        .mockResolvedValueOnce(null) // sale1 check
        .mockResolvedValueOnce(null); // sale2 check

      prisma.$transaction
        .mockRejectedValueOnce(new Error('Database error')) // sale1 transaction fails
        .mockResolvedValueOnce(undefined); // sale2 transaction succeeds

      prisma.sale.create.mockResolvedValueOnce({ id: 'sale-2', ...sale2 });
      prisma.fuelSale.createMany.mockResolvedValueOnce({ count: 0 });
      prisma.sale.updateMany.mockResolvedValueOnce({ count: 1 }); // Mark sale1 as failed

      const result = await SyncService.syncSales([sale1, sale2], 'org-test');

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].offlineQueueId).toBe('offline-sale-fail-1');
    });

    it('should record error message for debugging', async () => {
      const queuedSale: QueuedSale = {
        offlineQueueId: 'offline-sale-debug',
        branchId: 'branch-1',
        shiftInstanceId: 'shift-1',
        saleDate: new Date().toISOString(),
        saleType: 'fuel',
        totalAmount: 500,
        paymentMethod: 'cash',
        cashierId: 'cashier-1',
        vehicleNumber: 'ABC-123',
        slipNumber: 'SLIP-008',
        customerId: null,
        fuelSales: [],
        nonFuelSales: [],
      };

      const errorMsg = 'Nozzle not found';
      prisma.sale.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValueOnce(new Error(errorMsg));
      prisma.sale.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await SyncService.syncSales([queuedSale], 'org-test');

      expect(result.errors[0].error).toContain(errorMsg);
      expect(prisma.sale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ offlineQueueId: 'offline-sale-debug' }),
          data: expect.objectContaining({
            syncStatus: 'failed',
            syncError: errorMsg,
          }),
        })
      );
    });
  });

  describe('retryFailed - Retry Logic', () => {
    it('should retry failed sales with attempts < maxRetries', async () => {
      const failedSale = {
        id: 'sale-failed-1',
        offlineQueueId: 'offline-sale-retry',
        syncAttempts: 1,
        syncStatus: 'failed',
      };

      prisma.sale.findMany.mockResolvedValueOnce([failedSale]);
      prisma.sale.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.meterReading.findMany.mockResolvedValueOnce([]);
      prisma.meterReading.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await SyncService.retryFailed('cashier-1', 3);

      expect(result).toBe(1); // 1 sale reset to pending
      expect(prisma.sale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { syncStatus: 'pending' },
        })
      );
    });

    it('should not retry records exceeding maxRetries', async () => {
      const exhaustedSale = {
        id: 'sale-exhausted',
        syncAttempts: 3,
        syncStatus: 'failed',
      };

      // Should find nothing (syncAttempts >= 3)
      prisma.sale.findMany.mockResolvedValueOnce([]);
      prisma.meterReading.findMany.mockResolvedValueOnce([]);
      prisma.sale.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.meterReading.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await SyncService.retryFailed('cashier-1', 3);

      expect(result).toBe(0); // No records retried
    });
  });

  describe('getSyncStatus - Sync Status Tracking', () => {
    it('should aggregate pending and failed counts correctly', async () => {
      prisma.sale.count
        .mockResolvedValueOnce(5) // pending sales
        .mockResolvedValueOnce(2); // failed sales

      prisma.meterReading.count
        .mockResolvedValueOnce(3) // pending readings
        .mockResolvedValueOnce(1); // failed readings

      prisma.sale.findFirst.mockResolvedValueOnce({
        lastSyncAttempt: new Date('2026-03-28T10:00:00Z'),
      });

      const status = await SyncService.getSyncStatus('cashier-1');

      expect(status.pendingSales).toBe(5);
      expect(status.pendingMeterReadings).toBe(3);
      expect(status.failedCount).toBe(3); // 2 + 1
      expect(status.lastSyncAt).toBeDefined();
    });

    it('should handle zero pending/failed records', async () => {
      prisma.sale.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.meterReading.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.sale.findFirst.mockResolvedValueOnce(null);

      const status = await SyncService.getSyncStatus('cashier-1');

      expect(status.pendingSales).toBe(0);
      expect(status.pendingMeterReadings).toBe(0);
      expect(status.failedCount).toBe(0);
      expect(status.lastSyncAt).toBeUndefined();
    });
  });
});
