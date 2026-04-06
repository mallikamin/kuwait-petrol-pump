/**
 * Web Offline Queue - IndexedDB Implementation
 * Sprint 1: Offline Foundation
 *
 * Browser-based offline queue for POS sales transactions.
 * Provides same contract as mobile queue.
 */

import { v4 as uuidv4 } from 'uuid';
import { apiClient } from '@/api/client';

const DB_NAME = 'KuwaitPOS_OfflineQueue';
const DB_VERSION = 2; // Increment for new stores
const SALES_STORE = 'sales';
const METER_READINGS_STORE = 'meter_readings';
const BACKDATED_TRANSACTIONS_STORE = 'backdated_transactions';
const META_STORE = 'metadata';

export interface QueuedSale {
  offlineQueueId: string;
  branchId: string;
  shiftInstanceId?: string;
  saleDate: string;
  saleType: 'fuel' | 'non_fuel';
  totalAmount: number;
  taxAmount?: number;
  discountAmount?: number;
  paymentMethod: 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
  bankId?: string; // Required if paymentMethod='credit_card' or 'bank_card'
  customerId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  cashierId?: string;
  fuelSales?: Array<{
    nozzleId?: string; // Optional - POS doesn't track nozzles
    fuelTypeId: string;
    quantityLiters: number;
    pricePerLiter: number;
    totalAmount: number;
    previousReading?: number;
    currentReading?: number;
    calculatedLiters?: number;
    imageUrl?: string;
    ocrConfidence?: number;
    isManualReading?: boolean;
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

export interface QueuedBackdatedTransaction {
  offlineQueueId: string;
  branchId: string;
  businessDate: string;
  shiftId?: string;
  customerId?: string;
  fuelCode?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: string;
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface QueuedMeterReading {
  offlineQueueId: string;
  nozzleId: string;
  shiftId: string;
  readingType: 'opening' | 'closing';
  meterValue: number;
  customTimestamp: string;
  imageUrl?: string;
  ocrConfidence?: number;
  isManualOverride: boolean;
  isOcr: boolean;
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface QueueStatus {
  salesCount: number;
  transactionsCount: number;
  meterReadingsCount: number;
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  lastSyncAt?: string;
  isOnline: boolean;
}

export class OfflineQueue {
  private static db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB
   */
  private static async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create sales store
        if (!db.objectStoreNames.contains(SALES_STORE)) {
          const salesStore = db.createObjectStore(SALES_STORE, {
            keyPath: 'offlineQueueId',
          });
          salesStore.createIndex('status', 'status', { unique: false });
          salesStore.createIndex('queuedAt', 'queuedAt', { unique: false });
        }

        // Create meter readings store
        if (!db.objectStoreNames.contains(METER_READINGS_STORE)) {
          const readingsStore = db.createObjectStore(METER_READINGS_STORE, {
            keyPath: 'offlineQueueId',
          });
          readingsStore.createIndex('status', 'status', { unique: false });
        }

        // Create backdated transactions store
        if (!db.objectStoreNames.contains(BACKDATED_TRANSACTIONS_STORE)) {
          const transactionsStore = db.createObjectStore(BACKDATED_TRANSACTIONS_STORE, {
            keyPath: 'offlineQueueId',
          });
          transactionsStore.createIndex('status', 'status', { unique: false });
          transactionsStore.createIndex('businessDate', 'businessDate', { unique: false });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Enqueue a sale for offline sync
   */
  static async enqueueSale(
    sale: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'>
  ): Promise<string> {
    const db = await this.initDB();
    const offlineQueueId = uuidv4();
    const queuedSale: QueuedSale = {
      ...sale,
      offlineQueueId,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readwrite');
      const store = transaction.objectStore(SALES_STORE);
      const request = store.add(queuedSale);

      request.onsuccess = () => {
        console.log(`📥 Enqueued sale: ${offlineQueueId}`);
        resolve(offlineQueueId);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending sales from queue
   */
  static async getPendingSales(): Promise<QueuedSale[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readonly');
      const store = transaction.objectStore(SALES_STORE);
      const index = store.index('status');
      const request = index.getAll('pending');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all sales from queue (any status)
   */
  static async getAllSales(): Promise<QueuedSale[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readonly');
      const store = transaction.objectStore(SALES_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark sale as synced and remove from queue
   */
  static async markSaleSynced(offlineQueueId: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readwrite');
      const store = transaction.objectStore(SALES_STORE);
      const request = store.delete(offlineQueueId);

      request.onsuccess = () => {
        console.log(`✅ Marked sale synced: ${offlineQueueId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark sale as failed and increment attempts
   */
  static async markSaleFailed(offlineQueueId: string, error: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readwrite');
      const store = transaction.objectStore(SALES_STORE);
      const getRequest = store.get(offlineQueueId);

      getRequest.onsuccess = () => {
        const sale = getRequest.result;
        if (sale) {
          sale.status = 'failed';
          sale.attempts += 1;
          sale.error = error;

          const putRequest = store.put(sale);
          putRequest.onsuccess = () => {
            console.error(`❌ Marked sale failed: ${offlineQueueId} (${sale.attempts} attempts)`, error);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(); // Sale not found, nothing to update
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Retry failed records (reset status to pending)
   */
  static async retryFailed(maxAttempts = 3): Promise<number> {
    const db = await this.initDB();
    let retried = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readwrite');
      const store = transaction.objectStore(SALES_STORE);
      const index = store.index('status');
      const request = index.openCursor(IDBKeyRange.only('failed'));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const sale = cursor.value;
          if (sale.attempts < maxAttempts) {
            sale.status = 'pending';
            cursor.update(sale);
            retried++;
          }
          cursor.continue();
        } else {
          console.log(`🔄 Retried ${retried} failed sales`);
          resolve(retried);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Flush pending records when online
   * Uses apiClient with automatic JWT token injection
   */
  static async flushWhenOnline(
    deviceId: string
  ): Promise<{
    synced: number;
    failed: number;
    duplicates: number;
  }> {
    // Check navigator online status
    if (!navigator.onLine) {
      throw new Error('No internet connection');
    }

    const pendingSales = await this.getPendingSales();

    if (pendingSales.length === 0) {
      console.log('📭 No pending sales to sync');
      return { synced: 0, failed: 0, duplicates: 0 };
    }

    console.log(`📤 Flushing ${pendingSales.length} sales`);

    try {
      // Call backend sync endpoint with JWT auth (via apiClient interceptor)
      const response = await apiClient.post('/api/sync/queue', {
        deviceId,
        sales: pendingSales,
      });

      const result = response.data;

      // Mark synced/failed records
      for (const sale of pendingSales) {
        const error = result.details.sales.errors.find(
          (e: any) => e.offlineQueueId === sale.offlineQueueId
        );
        if (error) {
          await this.markSaleFailed(sale.offlineQueueId, error.error);
        } else {
          await this.markSaleSynced(sale.offlineQueueId);
        }
      }

      // Save last sync timestamp
      await this.setMetadata('last_sync', new Date().toISOString());

      console.log(
        `✅ Sync complete: ${result.synced} synced, ${result.failed} failed, ${result.duplicates} duplicates`
      );

      return {
        synced: result.synced,
        failed: result.failed,
        duplicates: result.duplicates,
      };
    } catch (error: any) {
      const errorDetails = {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      };
      console.error('❌ Flush failed:', errorDetails);
      throw error;
    }
  }

  /**
   * Enqueue backdated transaction for offline sync
   */
  static async enqueueBackdatedTransaction(
    transaction: Omit<QueuedBackdatedTransaction, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'>
  ): Promise<string> {
    const db = await this.initDB();
    const offlineQueueId = uuidv4();
    const queuedTransaction: QueuedBackdatedTransaction = {
      ...transaction,
      offlineQueueId,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([BACKDATED_TRANSACTIONS_STORE], 'readwrite');
      const store = tx.objectStore(BACKDATED_TRANSACTIONS_STORE);
      const request = store.add(queuedTransaction);

      request.onsuccess = () => {
        console.log(`📥 Enqueued backdated transaction: ${offlineQueueId}`);
        resolve(offlineQueueId);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Enqueue meter reading for offline sync
   */
  static async enqueueMeterReading(
    reading: Omit<QueuedMeterReading, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'>
  ): Promise<string> {
    const db = await this.initDB();
    const offlineQueueId = uuidv4();
    const queuedReading: QueuedMeterReading = {
      ...reading,
      offlineQueueId,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([METER_READINGS_STORE], 'readwrite');
      const store = tx.objectStore(METER_READINGS_STORE);
      const request = store.add(queuedReading);

      request.onsuccess = () => {
        console.log(`📥 Enqueued meter reading: ${offlineQueueId}`);
        resolve(offlineQueueId);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending backdated transactions
   */
  static async getPendingBackdatedTransactions(): Promise<QueuedBackdatedTransaction[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BACKDATED_TRANSACTIONS_STORE], 'readonly');
      const store = transaction.objectStore(BACKDATED_TRANSACTIONS_STORE);
      const index = store.index('status');
      const request = index.getAll('pending');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending meter readings
   */
  static async getPendingMeterReadings(): Promise<QueuedMeterReading[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([METER_READINGS_STORE], 'readonly');
      const store = transaction.objectStore(METER_READINGS_STORE);
      const index = store.index('status');
      const request = index.getAll('pending');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get queue status
   */
  static async getStatus(): Promise<QueueStatus> {
    const allSales = await this.getAllSales();
    const allTransactions = await this.getPendingBackdatedTransactions();
    const allReadings = await this.getPendingMeterReadings();
    const lastSyncAt = await this.getMetadata('last_sync');

    const totalPending = allSales.filter(s => s.status === 'pending').length +
                        allTransactions.filter(t => t.status === 'pending').length +
                        allReadings.filter(r => r.status === 'pending').length;

    const totalFailed = allSales.filter(s => s.status === 'failed').length +
                       allTransactions.filter(t => t.status === 'failed').length +
                       allReadings.filter(r => r.status === 'failed').length;

    return {
      salesCount: allSales.length,
      transactionsCount: allTransactions.length,
      meterReadingsCount: allReadings.length,
      pendingCount: totalPending,
      syncedCount: 0, // Synced items are removed from queue
      failedCount: totalFailed,
      lastSyncAt: lastSyncAt || undefined,
      isOnline: navigator.onLine,
    };
  }

  /**
   * Clear all queues (use with caution!)
   */
  static async clearAll(): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        [SALES_STORE, METER_READINGS_STORE, META_STORE],
        'readwrite'
      );

      transaction.objectStore(SALES_STORE).clear();
      transaction.objectStore(METER_READINGS_STORE).clear();
      transaction.objectStore(META_STORE).clear();

      transaction.oncomplete = () => {
        console.log('🗑️  Cleared all queues');
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Metadata helpers

  private static async setMetadata(key: string, value: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([META_STORE], 'readwrite');
      const store = transaction.objectStore(META_STORE);
      const request = store.put({ key, value });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private static async getMetadata(key: string): Promise<string | null> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([META_STORE], 'readonly');
      const store = transaction.objectStore(META_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
}
