/**
 * Mobile Offline Queue Service
 * Sprint 1: Offline Foundation
 *
 * AsyncStorage-backed queue for offline transactions.
 * Provides: enqueue, dequeue, retry, markSynced, markFailed, flushWhenOnline
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { v4 as uuidv4 } from 'uuid';
import apiClient from '../api/client';

// Storage keys
const QUEUE_KEY_PREFIX = '@offline_queue:';
const SALE_QUEUE_KEY = `${QUEUE_KEY_PREFIX}sales`;
const METER_READING_QUEUE_KEY = `${QUEUE_KEY_PREFIX}meter_readings`;

export interface QueuedSale {
  offlineQueueId: string;
  branchId: string;
  shiftInstanceId?: string;
  saleDate: string;
  saleType: 'fuel' | 'non_fuel';
  totalAmount: number;
  taxAmount?: number;
  discountAmount?: number;
  paymentMethod: 'cash' | 'credit' | 'card' | 'pso_card' | 'other';
  customerId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  cashierId?: string;
  fuelSales?: Array<{
    nozzleId: string;
    fuelTypeId: string;
    quantityLiters: number;
    pricePerLiter: number;
    totalAmount: number;
  }>;
  nonFuelSales?: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }>;
  // Queue metadata
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface QueuedMeterReading {
  offlineQueueId: string;
  nozzleId: string;
  shiftInstanceId: string;
  readingType: 'opening' | 'closing';
  meterValue: number;
  imageUrl?: string;
  ocrResult?: number;
  isManualOverride: boolean;
  recordedBy?: string;
  recordedAt: string;
  // Queue metadata
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface QueueStatus {
  salesCount: number;
  meterReadingsCount: number;
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  lastSyncAt?: string;
}

export class OfflineQueue {
  /**
   * Enqueue a sale for offline sync
   */
  static async enqueueSale(sale: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'>): Promise<string> {
    const offlineQueueId = uuidv4();
    const queuedSale: QueuedSale = {
      ...sale,
      offlineQueueId,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    const queue = await this.getSalesQueue();
    queue.push(queuedSale);
    await this.saveSalesQueue(queue);

    console.log(`📥 Enqueued sale: ${offlineQueueId}`);
    return offlineQueueId;
  }

  /**
   * Enqueue a meter reading for offline sync
   */
  static async enqueueMeterReading(
    reading: Omit<QueuedMeterReading, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'>
  ): Promise<string> {
    const offlineQueueId = uuidv4();
    const queuedReading: QueuedMeterReading = {
      ...reading,
      offlineQueueId,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    const queue = await this.getMeterReadingsQueue();
    queue.push(queuedReading);
    await this.saveMeterReadingsQueue(queue);

    console.log(`📥 Enqueued meter reading: ${offlineQueueId}`);
    return offlineQueueId;
  }

  /**
   * Get all pending sales from queue
   */
  static async getPendingSales(): Promise<QueuedSale[]> {
    const queue = await this.getSalesQueue();
    return queue.filter(s => s.status === 'pending');
  }

  /**
   * Get all pending meter readings from queue
   */
  static async getPendingMeterReadings(): Promise<QueuedMeterReading[]> {
    const queue = await this.getMeterReadingsQueue();
    return queue.filter(r => r.status === 'pending');
  }

  /**
   * Mark sale as synced and remove from queue
   */
  static async markSaleSynced(offlineQueueId: string): Promise<void> {
    const queue = await this.getSalesQueue();
    const updated = queue.filter(s => s.offlineQueueId !== offlineQueueId);
    await this.saveSalesQueue(updated);
    console.log(`✅ Marked sale synced: ${offlineQueueId}`);
  }

  /**
   * Mark meter reading as synced and remove from queue
   */
  static async markMeterReadingSynced(offlineQueueId: string): Promise<void> {
    const queue = await this.getMeterReadingsQueue();
    const updated = queue.filter(r => r.offlineQueueId !== offlineQueueId);
    await this.saveMeterReadingsQueue(updated);
    console.log(`✅ Marked meter reading synced: ${offlineQueueId}`);
  }

  /**
   * Mark sale as failed and increment attempts
   */
  static async markSaleFailed(offlineQueueId: string, error: string): Promise<void> {
    const queue = await this.getSalesQueue();
    const sale = queue.find(s => s.offlineQueueId === offlineQueueId);
    if (sale) {
      sale.status = 'failed';
      sale.attempts += 1;
      sale.error = error;
      await this.saveSalesQueue(queue);
      console.log(`❌ Marked sale failed: ${offlineQueueId} (${sale.attempts} attempts)`);
    }
  }

  /**
   * Mark meter reading as failed and increment attempts
   */
  static async markMeterReadingFailed(offlineQueueId: string, error: string): Promise<void> {
    const queue = await this.getMeterReadingsQueue();
    const reading = queue.find(r => r.offlineQueueId === offlineQueueId);
    if (reading) {
      reading.status = 'failed';
      reading.attempts += 1;
      reading.error = error;
      await this.saveMeterReadingsQueue(queue);
      console.log(`❌ Marked meter reading failed: ${offlineQueueId} (${reading.attempts} attempts)`);
    }
  }

  /**
   * Retry failed records (reset status to pending)
   */
  static async retryFailed(maxAttempts = 3): Promise<number> {
    let retried = 0;

    // Retry sales
    const salesQueue = await this.getSalesQueue();
    salesQueue.forEach(sale => {
      if (sale.status === 'failed' && sale.attempts < maxAttempts) {
        sale.status = 'pending';
        retried++;
      }
    });
    await this.saveSalesQueue(salesQueue);

    // Retry meter readings
    const readingsQueue = await this.getMeterReadingsQueue();
    readingsQueue.forEach(reading => {
      if (reading.status === 'failed' && reading.attempts < maxAttempts) {
        reading.status = 'pending';
        retried++;
      }
    });
    await this.saveMeterReadingsQueue(readingsQueue);

    console.log(`🔄 Retried ${retried} failed records`);
    return retried;
  }

  /**
   * Flush pending records when online
   * Uses apiClient with automatic JWT token injection
   * Returns: { synced, failed, duplicates }
   */
  static async flushWhenOnline(deviceId: string): Promise<{
    synced: number;
    failed: number;
    duplicates: number;
  }> {
    // Check network status
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected) {
      throw new Error('No internet connection');
    }

    const pendingSales = await this.getPendingSales();
    const pendingMeterReadings = await this.getPendingMeterReadings();

    if (pendingSales.length === 0 && pendingMeterReadings.length === 0) {
      console.log('📭 No pending records to sync');
      return { synced: 0, failed: 0, duplicates: 0 };
    }

    console.log(`📤 Flushing ${pendingSales.length} sales + ${pendingMeterReadings.length} meter readings`);

    try {
      // Call backend sync endpoint with JWT auth (via apiClient interceptor)
      const response = await apiClient.post('/sync/queue', {
        deviceId,
        sales: pendingSales,
        meterReadings: pendingMeterReadings,
      });

      const result = response.data;

      // Mark synced records
      for (const sale of pendingSales) {
        if (!result.details.sales.errors.find((e: any) => e.offlineQueueId === sale.offlineQueueId)) {
          await this.markSaleSynced(sale.offlineQueueId);
        } else {
          const error = result.details.sales.errors.find((e: any) => e.offlineQueueId === sale.offlineQueueId);
          await this.markSaleFailed(sale.offlineQueueId, error.error);
        }
      }

      for (const reading of pendingMeterReadings) {
        if (!result.details.meterReadings.errors.find((e: any) => e.offlineQueueId === reading.offlineQueueId)) {
          await this.markMeterReadingSynced(reading.offlineQueueId);
        } else {
          const error = result.details.meterReadings.errors.find((e: any) => e.offlineQueueId === reading.offlineQueueId);
          await this.markMeterReadingFailed(reading.offlineQueueId, error.error);
        }
      }

      // Save last sync timestamp
      await AsyncStorage.setItem(`${QUEUE_KEY_PREFIX}last_sync`, new Date().toISOString());

      console.log(`✅ Sync complete: ${result.synced} synced, ${result.failed} failed, ${result.duplicates} duplicates`);

      return {
        synced: result.synced,
        failed: result.failed,
        duplicates: result.duplicates,
      };
    } catch (error) {
      console.error('❌ Flush failed:', error);
      throw error;
    }
  }

  /**
   * Get queue status
   */
  static async getStatus(): Promise<QueueStatus> {
    const salesQueue = await this.getSalesQueue();
    const readingsQueue = await this.getMeterReadingsQueue();

    const pendingCount = salesQueue.filter(s => s.status === 'pending').length +
                         readingsQueue.filter(r => r.status === 'pending').length;
    const syncedCount = 0; // Synced items are removed from queue
    const failedCount = salesQueue.filter(s => s.status === 'failed').length +
                        readingsQueue.filter(r => r.status === 'failed').length;

    const lastSyncAt = await AsyncStorage.getItem(`${QUEUE_KEY_PREFIX}last_sync`);

    return {
      salesCount: salesQueue.length,
      meterReadingsCount: readingsQueue.length,
      pendingCount,
      syncedCount,
      failedCount,
      lastSyncAt: lastSyncAt || undefined,
    };
  }

  /**
   * Clear all queues (use with caution!)
   */
  static async clearAll(): Promise<void> {
    await AsyncStorage.removeItem(SALE_QUEUE_KEY);
    await AsyncStorage.removeItem(METER_READING_QUEUE_KEY);
    await AsyncStorage.removeItem(`${QUEUE_KEY_PREFIX}last_sync`);
    console.log('🗑️  Cleared all queues');
  }

  // Private helper methods

  private static async getSalesQueue(): Promise<QueuedSale[]> {
    try {
      const json = await AsyncStorage.getItem(SALE_QUEUE_KEY);
      return json ? JSON.parse(json) : [];
    } catch (error) {
      console.error('Failed to get sales queue:', error);
      return [];
    }
  }

  private static async saveSalesQueue(queue: QueuedSale[]): Promise<void> {
    try {
      await AsyncStorage.setItem(SALE_QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
      console.error('Failed to save sales queue:', error);
      throw error;
    }
  }

  private static async getMeterReadingsQueue(): Promise<QueuedMeterReading[]> {
    try {
      const json = await AsyncStorage.getItem(METER_READING_QUEUE_KEY);
      return json ? JSON.parse(json) : [];
    } catch (error) {
      console.error('Failed to get meter readings queue:', error);
      return [];
    }
  }

  private static async saveMeterReadingsQueue(queue: QueuedMeterReading[]): Promise<void> {
    try {
      await AsyncStorage.setItem(METER_READING_QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
      console.error('Failed to save meter readings queue:', error);
      throw error;
    }
  }
}
