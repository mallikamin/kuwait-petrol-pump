/**
 * Offline Sync Types
 * Sprint 1: Offline Foundation
 */

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface QueuedSale {
  offlineQueueId: string; // Idempotency key (UUID generated offline)
  branchId: string;
  shiftInstanceId?: string;
  saleDate: string; // ISO timestamp
  saleType: 'fuel' | 'non_fuel';
  totalAmount: number;
  taxAmount?: number;
  discountAmount?: number;
  paymentMethod: 'cash' | 'credit' | 'card' | 'pso_card' | 'other';
  bankId?: string; // Required for card payments
  customerId?: string;
  vehicleNumber?: string;
  slipNumber?: string;
  cashierId?: string;
  // Line items
  fuelSales?: Array<{
    nozzleId?: string; // Optional - POS doesn't track nozzles
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
}

export interface QueuedMeterReading {
  offlineQueueId: string; // Idempotency key
  nozzleId: string;
  shiftInstanceId: string;
  readingType: 'opening' | 'closing';
  meterValue: number;
  imageUrl?: string;
  ocrResult?: number;
  isManualOverride: boolean;
  recordedBy?: string;
  recordedAt: string; // ISO timestamp
}

export interface SyncQueueRequest {
  deviceId: string; // Mobile device ID or web browser ID
  userId: string; // User performing sync
  sales?: QueuedSale[];
  meterReadings?: QueuedMeterReading[];
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  duplicates: number;
  errors: Array<{
    offlineQueueId: string;
    error: string;
  }>;
}

export interface SyncStatusResponse {
  deviceId: string;
  userId: string;
  pendingSales: number;
  pendingMeterReadings: number;
  lastSyncAt?: string;
  failedCount: number;
}
