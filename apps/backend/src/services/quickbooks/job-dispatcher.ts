/**
 * QuickBooks Job Dispatcher
 *
 * Routes queue jobs to appropriate handlers based on entityType and operation
 * Supports incremental handler addition without breaking existing functionality
 */

import { QBSyncQueue } from '@prisma/client';
import { handleFuelSaleCreate, FuelSalePayload } from './handlers/fuel-sale.handler';
import { handleVendorCreate, VendorPayload } from './handlers/vendor.handler';
import { handlePurchaseCreate, PurchasePayload } from './handlers/purchase.handler';
import { handleBillPaymentCreate, BillPaymentPayload } from './handlers/bill-payment.handler';

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

/**
 * Main dispatcher - routes jobs to handlers
 *
 * @param job - Queue job to execute
 * @returns Job execution result
 * @throws Error if entityType/jobType combination is unsupported
 */
export async function dispatch(job: QBSyncQueue): Promise<JobResult> {
  // Route based on entity type and job type
  if (job.entityType === 'sale' && job.jobType === 'create_sales_receipt') {
    const payload = parsePayload<FuelSalePayload>(job.payload);
    return await handleFuelSaleCreate(job, payload);
  }

  if (job.entityType === 'supplier' && job.jobType === 'create_vendor') {
    const payload = parsePayload<VendorPayload>(job.payload);
    return await handleVendorCreate(job, payload);
  }

  if (job.entityType === 'purchase_order' && job.jobType === 'create_bill') {
    const payload = parsePayload<PurchasePayload>(job.payload);
    return await handlePurchaseCreate(job, payload);
  }

  if (job.entityType === 'supplier_payment' && job.jobType === 'create_bill_payment') {
    const payload = parsePayload<BillPaymentPayload>(job.payload);
    return await handleBillPaymentCreate(job, payload);
  }

  // Unsupported combinations throw explicit error
  throw new Error(
    `Unsupported dispatch path: entityType=${job.entityType}, jobType=${job.jobType}`
  );
}

/**
 * Parse payload (handles both string JSON and object)
 */
function parsePayload<T>(payload: any): T {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as T;
    } catch (parseError) {
      throw new Error(
        `Invalid JSON payload: ${parseError instanceof Error ? parseError.message : 'Malformed JSON string'}`
      );
    }
  } else if (typeof payload === 'object' && payload !== null) {
    return payload as unknown as T;
  } else {
    throw new Error('Invalid payload: must be JSON string or object');
  }
}
