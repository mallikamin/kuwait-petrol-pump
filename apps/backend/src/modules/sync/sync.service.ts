/**
 * Offline Sync Service
 * Sprint 1: Offline Foundation + Pre-Deployment Hardening
 *
 * Handles deterministic idempotent processing of offline queued transactions.
 * ⚠️ CRITICAL: No duplicate sales/meter readings allowed.
 * ⚠️ MULTI-TENANT: All foreign keys validated against organizationId before write.
 */

import { PrismaClient } from '@prisma/client';
import {
  QueuedSale,
  QueuedMeterReading,
  SyncResult,
  SyncStatusResponse,
} from './sync.types';
import { TenantValidator } from './tenant-validator';
import { enqueueQbSaleSync } from '../../services/quickbooks/enqueue-sale';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';

const prisma = new PrismaClient();

export class SyncService {
  /**
   * Sync queued sales (idempotent - uses tenant-scoped offlineQueueId)
   *
   * @param sales Array of queued sales from offline device
   * @param organizationId Organization UUID from JWT (req.user.organizationId)
   * @returns Result with synced/failed/duplicate counts
   */
  static async syncSales(sales: QueuedSale[], organizationId: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced: 0,
      failed: 0,
      duplicates: 0,
      errors: [],
    };

    for (const queuedSale of sales) {
      try {
        // CRITICAL: Validate tenant access BEFORE any database operation
        await TenantValidator.validateSaleForeignKeys(queuedSale, organizationId);

        // Idempotency check: Tenant-scoped uniqueness (branchId + offlineQueueId)
        // New schema has @@unique([branchId, offlineQueueId])
        const existing = await prisma.sale.findFirst({
          where: {
            branchId: queuedSale.branchId,
            offlineQueueId: queuedSale.offlineQueueId,
          },
        });

        if (existing) {
          // Already synced - skip (idempotent behavior)
          result.duplicates++;
          continue;
        }

        // Create sale with line items in a transaction (atomic)
        const createdSale = await prisma.$transaction(async (tx) => {
          // Create master sale record
          const sale = await tx.sale.create({
            data: {
              branchId: queuedSale.branchId,
              shiftInstanceId: queuedSale.shiftInstanceId,
              saleDate: new Date(queuedSale.saleDate),
              saleType: queuedSale.saleType,
              totalAmount: queuedSale.totalAmount,
              taxAmount: queuedSale.taxAmount || 0,
              discountAmount: queuedSale.discountAmount || 0,
              paymentMethod: queuedSale.paymentMethod,
              bankId: queuedSale.bankId, // Required for card payments
              customerId: queuedSale.customerId,
              vehicleNumber: queuedSale.vehicleNumber,
              slipNumber: queuedSale.slipNumber,
              cashierId: queuedSale.cashierId,
              // Sync tracking
              syncStatus: 'synced',
              offlineQueueId: queuedSale.offlineQueueId,
              syncAttempts: 1,
              lastSyncAttempt: new Date(),
            },
          });

          // Create fuel sale line items
          if (queuedSale.fuelSales && queuedSale.fuelSales.length > 0) {
            await tx.fuelSale.createMany({
              data: queuedSale.fuelSales.map((item) => ({
                saleId: sale.id,
                nozzleId: item.nozzleId,
                fuelTypeId: item.fuelTypeId,
                quantityLiters: item.quantityLiters,
                pricePerLiter: item.pricePerLiter,
                totalAmount: item.totalAmount,
              })),
            });
          }

          // Create non-fuel sale line items
          if (queuedSale.nonFuelSales && queuedSale.nonFuelSales.length > 0) {
            await tx.nonFuelSale.createMany({
              data: queuedSale.nonFuelSales.map((item) => ({
                saleId: sale.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalAmount: item.totalAmount,
              })),
            });
          }

          return sale;
        });

        // QB enqueue outside the transaction: sale is persisted; a transient
        // enqueue failure must not roll back a successful offline sync.
        await this.enqueueSaleToQb(createdSale, queuedSale, organizationId);

        // Cash ledger IN for cash sales synced from offline queue. Keep this
        // best-effort (tryPost) so ledger issues don't fail the sync.
        if (queuedSale.paymentMethod === 'cash') {
          await CashLedgerService.tryPost({
            organizationId,
            branchId: queuedSale.branchId,
            businessDate: createdSale.saleDate,
            shiftInstanceId: queuedSale.shiftInstanceId || null,
            direction: 'IN',
            source: 'SALE',
            sourceId: createdSale.id,
            amount: Number(queuedSale.totalAmount),
            memo: `Cash sale (offline sync) ${createdSale.id.slice(0, 8)}`,
            createdBy: queuedSale.cashierId || null,
          });
        }

        result.synced++;
      } catch (error) {
        result.failed++;
        result.success = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({
          offlineQueueId: queuedSale.offlineQueueId,
          error: errorMessage,
        });

        // Mark sale as failed (tenant-scoped)
        await this.markSaleFailed(queuedSale.branchId, queuedSale.offlineQueueId, errorMessage);
      }
    }

    return result;
  }

  private static async enqueueSaleToQb(
    createdSale: { id: string; saleDate: Date },
    queuedSale: QueuedSale,
    organizationId: string
  ): Promise<void> {
    try {
      const fuelTypeIds = (queuedSale.fuelSales || []).map((f) => f.fuelTypeId);
      const productIds = (queuedSale.nonFuelSales || []).map((nf) => nf.productId);

      const [fuelTypes, products] = await Promise.all([
        fuelTypeIds.length
          ? prisma.fuelType.findMany({ where: { id: { in: fuelTypeIds } }, select: { id: true, name: true } })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        productIds.length
          ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
      ]);

      const lineItems = [
        ...(queuedSale.fuelSales || []).map((f) => ({
          itemLocalId: f.fuelTypeId,
          itemName: fuelTypes.find((ft) => ft.id === f.fuelTypeId)?.name || 'Fuel',
          quantity: Number(f.quantityLiters),
          unitPrice: Number(f.pricePerLiter),
          amount: Number(f.totalAmount),
        })),
        ...(queuedSale.nonFuelSales || []).map((nf) => ({
          itemLocalId: nf.productId,
          itemName: products.find((p) => p.id === nf.productId)?.name || 'Product',
          quantity: Number(nf.quantity),
          unitPrice: Number(nf.unitPrice),
          amount: Number(nf.totalAmount),
        })),
      ];

      await enqueueQbSaleSync({
        saleId: createdSale.id,
        organizationId,
        saleDate: createdSale.saleDate,
        paymentMethod: queuedSale.paymentMethod,
        totalAmount: Number(queuedSale.totalAmount),
        customerId: queuedSale.customerId,
        bankId: queuedSale.bankId,
        lineItems,
      });
    } catch (err: any) {
      console.warn(
        `[QB enqueue][sync sale ${createdSale.id}] ${err?.message || err}. Sale persisted; QB needs manual replay.`
      );
    }
  }

  /**
   * Sync queued meter readings (idempotent - uses tenant-scoped offlineQueueId)
   *
   * @param readings Array of queued meter readings from offline device
   * @param organizationId Organization UUID from JWT (req.user.organizationId)
   * @returns Result with synced/failed/duplicate counts
   */
  static async syncMeterReadings(
    readings: QueuedMeterReading[],
    organizationId: string
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced: 0,
      failed: 0,
      duplicates: 0,
      errors: [],
    };

    for (const queuedReading of readings) {
      try {
        // CRITICAL: Validate tenant access BEFORE any database operation
        await TenantValidator.validateMeterReadingForeignKeys(queuedReading, organizationId);

        // Idempotency check: Tenant-scoped uniqueness (nozzleId + offlineQueueId)
        // New schema has @@unique([nozzleId, offlineQueueId])
        const existing = await prisma.meterReading.findFirst({
          where: {
            nozzleId: queuedReading.nozzleId,
            offlineQueueId: queuedReading.offlineQueueId,
          },
        });

        if (existing) {
          result.duplicates++;
          continue;
        }

        // Create meter reading
        await prisma.meterReading.create({
          data: {
            nozzleId: queuedReading.nozzleId,
            shiftInstanceId: queuedReading.shiftInstanceId,
            readingType: queuedReading.readingType,
            meterValue: queuedReading.meterValue,
            imageUrl: queuedReading.imageUrl,
            ocrResult: queuedReading.ocrResult,
            isManualOverride: queuedReading.isManualOverride,
            recordedBy: queuedReading.recordedBy,
            recordedAt: new Date(queuedReading.recordedAt),
            // Sync tracking
            syncStatus: 'synced',
            offlineQueueId: queuedReading.offlineQueueId,
            syncAttempts: 1,
            lastSyncAttempt: new Date(),
          },
        });

        result.synced++;
      } catch (error) {
        result.failed++;
        result.success = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({
          offlineQueueId: queuedReading.offlineQueueId,
          error: errorMessage,
        });

        // Mark meter reading as failed (tenant-scoped)
        await this.markMeterReadingFailed(
          queuedReading.nozzleId,
          queuedReading.offlineQueueId,
          errorMessage
        );
      }
    }

    return result;
  }

  /**
   * Get sync status for a device/user
   *
   * @param userId User ID
   * @returns Sync status with pending/failed counts
   */
  static async getSyncStatus(userId: string): Promise<SyncStatusResponse> {
    // Count pending sales
    const pendingSales = await prisma.sale.count({
      where: {
        cashierId: userId,
        syncStatus: 'pending',
      },
    });

    // Count pending meter readings
    const pendingMeterReadings = await prisma.meterReading.count({
      where: {
        recordedBy: userId,
        syncStatus: 'pending',
      },
    });

    // Count failed records
    const failedSales = await prisma.sale.count({
      where: {
        cashierId: userId,
        syncStatus: 'failed',
      },
    });

    const failedMeterReadings = await prisma.meterReading.count({
      where: {
        recordedBy: userId,
        syncStatus: 'failed',
      },
    });

    // Get last sync timestamp
    const lastSyncedSale = await prisma.sale.findFirst({
      where: {
        cashierId: userId,
        syncStatus: 'synced',
      },
      orderBy: {
        lastSyncAttempt: 'desc',
      },
      select: {
        lastSyncAttempt: true,
      },
    });

    return {
      deviceId: 'unknown', // Will be passed from client
      userId,
      pendingSales,
      pendingMeterReadings,
      lastSyncAt: lastSyncedSale?.lastSyncAttempt?.toISOString(),
      failedCount: failedSales + failedMeterReadings,
    };
  }

  /**
   * Mark a sale as failed with error message (tenant-scoped)
   */
  private static async markSaleFailed(
    branchId: string,
    offlineQueueId: string,
    errorMessage: string
  ): Promise<void> {
    try {
      await prisma.sale.updateMany({
        where: {
          branchId,
          offlineQueueId,
        },
        data: {
          syncStatus: 'failed',
          syncAttempts: { increment: 1 },
          lastSyncAttempt: new Date(),
          syncError: errorMessage,
        },
      });
    } catch (error) {
      // Silent fail (already in error handler)
    }
  }

  /**
   * Mark a meter reading as failed with error message (tenant-scoped)
   */
  private static async markMeterReadingFailed(
    nozzleId: string,
    offlineQueueId: string,
    errorMessage: string
  ): Promise<void> {
    try {
      await prisma.meterReading.updateMany({
        where: {
          nozzleId,
          offlineQueueId,
        },
        data: {
          syncStatus: 'failed',
          syncAttempts: { increment: 1 },
          lastSyncAttempt: new Date(),
          syncError: errorMessage,
        },
      });
    } catch (error) {
      // Silent fail (already in error handler)
    }
  }

  /**
   * Retry failed sync records
   *
   * @param userId User ID
   * @param maxRetries Maximum retry attempts before giving up
   * @returns Number of records retried
   */
  static async retryFailed(userId: string, maxRetries = 3): Promise<number> {
    // Get failed sales with retry attempts < maxRetries
    const failedSales = await prisma.sale.findMany({
      where: {
        cashierId: userId,
        syncStatus: 'failed',
        syncAttempts: { lt: maxRetries },
      },
      include: {
        fuelSales: true,
        nonFuelSales: true,
      },
    });

    // Reset status to pending for retry
    const resetSales = await prisma.sale.updateMany({
      where: {
        id: { in: failedSales.map((s) => s.id) },
      },
      data: {
        syncStatus: 'pending',
      },
    });

    // Get failed meter readings
    const failedReadings = await prisma.meterReading.findMany({
      where: {
        recordedBy: userId,
        syncStatus: 'failed',
        syncAttempts: { lt: maxRetries },
      },
    });

    // Reset status to pending
    const resetReadings = await prisma.meterReading.updateMany({
      where: {
        id: { in: failedReadings.map((r) => r.id) },
      },
      data: {
        syncStatus: 'pending',
      },
    });

    return resetSales.count + resetReadings.count;
  }
}
