/**
 * Desktop Offline Queue - IndexedDB Implementation
 *
 * Same contract as web queue (apps/web/src/db/indexeddb.ts).
 * Electron renderer supports IndexedDB natively.
 * Uses desktop apiClient for sync (JWT token via interceptor).
 */

import { v4 as uuidv4 } from 'uuid';
import apiClient from '../api/client';

const DB_NAME = 'KuwaitPOS_OfflineQueue';
const DB_VERSION = 1;
const SALES_STORE = 'sales';
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
  paymentMethod: 'cash' | 'credit' | 'card' | 'pso_card' | 'other';
  customerId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
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
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface QueueStatus {
  salesCount: number;
  pendingCount: number;
  failedCount: number;
  lastSyncAt?: string;
}

export class OfflineQueue {
  private static db: IDBDatabase | null = null;

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

        if (!db.objectStoreNames.contains(SALES_STORE)) {
          const salesStore = db.createObjectStore(SALES_STORE, {
            keyPath: 'offlineQueueId',
          });
          salesStore.createIndex('status', 'status', { unique: false });
          salesStore.createIndex('queuedAt', 'queuedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
    });
  }

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
      request.onsuccess = () => resolve(offlineQueueId);
      request.onerror = () => reject(request.error);
    });
  }

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

  static async markSaleSynced(offlineQueueId: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE], 'readwrite');
      const store = transaction.objectStore(SALES_STORE);
      const request = store.delete(offlineQueueId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

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
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Flush pending records when online.
   * Uses apiClient with automatic JWT token injection.
   */
  static async flushWhenOnline(deviceId: string): Promise<{
    synced: number;
    failed: number;
    duplicates: number;
  }> {
    if (!navigator.onLine) {
      throw new Error('No internet connection');
    }

    const pendingSales = await this.getPendingSales();

    if (pendingSales.length === 0) {
      return { synced: 0, failed: 0, duplicates: 0 };
    }

    try {
      const response = await apiClient.post('/sync/queue', {
        deviceId,
        sales: pendingSales,
      });

      const result = response.data;

      for (const sale of pendingSales) {
        const error = result.details?.sales?.errors?.find(
          (e: any) => e.offlineQueueId === sale.offlineQueueId
        );
        if (error) {
          await this.markSaleFailed(sale.offlineQueueId, error.error);
        } else {
          await this.markSaleSynced(sale.offlineQueueId);
        }
      }

      await this.setMetadata('last_sync', new Date().toISOString());

      return {
        synced: result.synced,
        failed: result.failed,
        duplicates: result.duplicates,
      };
    } catch (error) {
      throw error;
    }
  }

  static async getStatus(): Promise<QueueStatus> {
    const allSales = await this.getAllSales();
    const lastSyncAt = await this.getMetadata('last_sync');

    return {
      salesCount: allSales.length,
      pendingCount: allSales.filter((s) => s.status === 'pending').length,
      failedCount: allSales.filter((s) => s.status === 'failed').length,
      lastSyncAt: lastSyncAt || undefined,
    };
  }

  static async clearAll(): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SALES_STORE, META_STORE], 'readwrite');
      transaction.objectStore(SALES_STORE).clear();
      transaction.objectStore(META_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

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
