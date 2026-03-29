/**
 * QuickBooks Job Dispatcher
 *
 * Routes queue jobs to appropriate handlers based on entityType and operation
 * Supports incremental handler addition without breaking existing functionality
 */

import { QBSyncQueue } from '@prisma/client';
import { handleFuelSaleCreate, FuelSalePayload } from './handlers/fuel-sale.handler';

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
    // Parse payload - handle both string (direct JSON) and object (Prisma JSONB)
    let payload: FuelSalePayload;
    if (typeof job.payload === 'string') {
      // Explicit try-catch for malformed JSON strings
      try {
        payload = JSON.parse(job.payload) as FuelSalePayload;
      } catch (parseError) {
        throw new Error(
          `Invalid JSON payload: ${parseError instanceof Error ? parseError.message : 'Malformed JSON string'}`
        );
      }
    } else if (typeof job.payload === 'object' && job.payload !== null) {
      // Prisma returns JsonValue type - safely cast through unknown
      payload = job.payload as unknown as FuelSalePayload;
    } else {
      throw new Error('Invalid payload: must be JSON string or object');
    }

    return await handleFuelSaleCreate(job, payload);
  }

  // Unsupported combinations throw explicit error
  throw new Error(
    `Unsupported dispatch path: entityType=${job.entityType}, jobType=${job.jobType}`
  );
}
