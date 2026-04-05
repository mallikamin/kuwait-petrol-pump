/**
 * QuickBooks Fuel Sale Handler
 *
 * Converts Kuwait POS fuel sales into QuickBooks Online SalesReceipts
 * Implements full OAuth token refresh, error handling, and audit logging
 */

import { QBSyncQueue } from '@prisma/client';
import { encryptToken } from '../encryption';
import { getValidAccessToken as getValidToken } from '../token-refresh';
import { AuditLogger } from '../audit-logger';
import { checkKillSwitch, checkSyncMode } from '../safety-gates';
import { CompanyLock } from '../company-lock';
import { EntityMappingService } from '../entity-mapping.service';
import { classifyError, logClassifiedError, OpLog } from '../error-classifier';
import { prisma } from '../../../config/database';

// QuickBooks OAuth2 endpoints
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com';
const QB_PRODUCTION_API = 'https://quickbooks.api.intuit.com';

export interface FuelSalePayload {
  saleId: string;
  organizationId: string;
  customerId?: string;
  bankId?: string; // Required if paymentMethod='card'
  txnDate: string;
  paymentMethod: string;
  lineItems: Array<{
    fuelTypeId: string;
    fuelTypeName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  taxAmount?: number;
  totalAmount: number;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

/**
 * Main handler for fuel sale creation in QuickBooks
 *
 * Flow:
 * 1. Validate payload
 * 2. Check organization isolation
 * 3. Check safety gates (kill switch, sync mode)
 * 4. Get QB connection
 * 5. Validate company lock (prevent concurrent writes)
 * 6. Refresh token if expired
 * 7. Build SalesReceipt JSON
 * 8. POST to QuickBooks API
 * 9. Return result
 */
export async function handleFuelSaleCreate(
  job: QBSyncQueue,
  payload: FuelSalePayload
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    // 1. Validate payload
    validatePayload(payload);

    // 2. Check organization isolation
    if (payload.organizationId !== job.organizationId) {
      throw new Error(
        `Organization mismatch: payload=${payload.organizationId}, job=${job.organizationId}`
      );
    }

    // 3. Check safety gates and get sync mode
    await checkKillSwitch(job.organizationId);
    const syncMode = await checkSyncMode(job.organizationId);

    // 4. Get QB connection
    const connection = await prisma.qBConnection.findFirst({
      where: {
        organizationId: job.organizationId,
        isActive: true
      }
    });

    if (!connection) {
      throw new Error('QuickBooks not connected for this organization');
    }

    // 5. Validate company lock (prevent concurrent writes to same QB company)
    await CompanyLock.validateRealmId(connection.id, connection.realmId);

    // 5a. Explicit connection/org/realm ownership validation
    await CompanyLock.lockConnectionToOrganization(connection.id, job.organizationId);

    // 6. Refresh token if expired
    const { accessToken } = await getValidToken(job.organizationId, prisma);

    // 7. Build SalesReceipt JSON (with entity mapping lookups)
    const salesReceiptPayload = await buildSalesReceiptPayload(job.organizationId, payload);

    // 8. Check if DRY_RUN mode - simulate success without QB API call
    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.saleId,
        'Sync mode is DRY_RUN - simulating success without QB API call'
      ));

      // Log dry-run execution
      await AuditLogger.log({
        operation: 'CREATE_SALES_RECEIPT_DRY_RUN',
        entity_type: 'sale',
        entity_id: payload.saleId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: salesReceiptPayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          note: 'Dry-run mode: No actual QB API call made. Payload validated and simulated success.'
        }
      });

      return {
        success: true,
        qbId: 'DRY_RUN',
        qbDocNumber: 'DRY_RUN'
      };
    }

    // 9. POST to QuickBooks API (FULL_SYNC mode only)
    console.log(`[QB Handler][FULL_SYNC] Creating sales receipt for sale ${payload.saleId}`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/salesreceipt?minorversion=65`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(salesReceiptPayload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = await response.json() as any;
    const salesReceipt = responseData.SalesReceipt;

    const duration = Date.now() - startTime;

    // 10. Log success
    console.log(OpLog.qbWriteSuccess('CREATE_SALES_RECEIPT', payload.saleId, salesReceipt.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_SALES_RECEIPT',
      entity_type: 'sale',
      entity_id: payload.saleId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: salesReceiptPayload,
      response_payload: salesReceipt,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: salesReceipt.Id,
        qbDocNumber: salesReceipt.DocNumber,
        durationMs: duration
      }
    });

    return {
      success: true,
      qbId: salesReceipt.Id,
      qbDocNumber: salesReceipt.DocNumber
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Classify error for operational handling
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));

    // Log classified error with stable prefix
    console.error(OpLog.qbWriteFail('CREATE_SALES_RECEIPT', payload.saleId, classified.category));
    logClassifiedError(error instanceof Error ? error : String(error));

    // Log failure (try to get syncMode if error occurred after gate check)
    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true }
      });
      syncMode = connection?.syncMode || 'UNKNOWN';
    } catch {
      // Ignore errors getting sync mode for error logging
    }

    await AuditLogger.log({
      operation: 'CREATE_SALES_RECEIPT',
      entity_type: 'sale',
      entity_id: payload.saleId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        jobId: job.id,
        syncMode,
        durationMs: duration,
        errorCategory: classified.category,
        errorSeverity: classified.severity,
        isRetryable: classified.isRetryable,
        recommendedAction: classified.action
      }
    });

    throw error;
  }
}

/**
 * Validate required fields in payload
 */
function validatePayload(payload: FuelSalePayload): void {
  if (!payload.saleId) {
    throw new Error('Missing required field: saleId');
  }
  if (!payload.organizationId) {
    throw new Error('Missing required field: organizationId');
  }
  if (!payload.txnDate) {
    throw new Error('Missing required field: txnDate');
  }
  if (!payload.lineItems || payload.lineItems.length === 0) {
    throw new Error('Missing required field: lineItems (must have at least 1 item)');
  }
  if (payload.totalAmount === undefined || payload.totalAmount < 0) {
    throw new Error('Invalid totalAmount');
  }

  // Validate line items
  payload.lineItems.forEach((item, index) => {
    if (!item.fuelTypeName) {
      throw new Error(`Line item ${index}: Missing fuelTypeName`);
    }
    if (item.quantity === undefined || item.quantity <= 0) {
      throw new Error(`Line item ${index}: Invalid quantity`);
    }
    if (item.unitPrice === undefined || item.unitPrice < 0) {
      throw new Error(`Line item ${index}: Invalid unitPrice`);
    }
    if (item.amount === undefined || item.amount < 0) {
      throw new Error(`Line item ${index}: Invalid amount`);
    }
  });
}

/**
 * Build QuickBooks SalesReceipt JSON payload
 * Uses EntityMappingService to resolve QB entity IDs
 */
async function buildSalesReceiptPayload(
  organizationId: string,
  payload: FuelSalePayload
): Promise<any> {
  // 1. Resolve customer mapping
  let customerQbId: string;

  if (payload.customerId) {
    // Map local customer ID to QB customer ID
    const mappedCustomerId = await EntityMappingService.getQbId(
      organizationId,
      'customer',
      payload.customerId
    );

    if (!mappedCustomerId) {
      throw new Error(
        `Customer mapping not found: localId=${payload.customerId}. ` +
        `Please create mapping via /api/quickbooks/mappings before syncing.`
      );
    }

    customerQbId = mappedCustomerId;
  } else {
    // No customer specified - use walk-in customer mapping
    // Fallback strategy: map 'walk-in' local ID to QB walk-in customer
    const walkInQbId = await EntityMappingService.getQbId(
      organizationId,
      'customer',
      'walk-in'
    );

    if (!walkInQbId) {
      throw new Error(
        `Walk-in customer mapping not found: localId=walk-in. ` +
        `Please create mapping via /api/quickbooks/mappings before syncing.`
      );
    }

    customerQbId = walkInQbId;
  }

  // 2. Resolve payment method mapping
  const paymentMethodQbId = await EntityMappingService.getQbId(
    organizationId,
    'payment_method',
    payload.paymentMethod
  );

  if (!paymentMethodQbId) {
    throw new Error(
      `Payment method mapping not found: localId=${payload.paymentMethod}. ` +
      `Please create mapping via /api/quickbooks/mappings before syncing.`
    );
  }

  // 2a. Resolve bank account mapping for card payments
  let depositToAccountQbId: string | undefined;

  if (payload.paymentMethod === 'card' || payload.paymentMethod === 'debit' || payload.paymentMethod === 'credit') {
    if (!payload.bankId) {
      throw new Error(
        `Bank ID required for card payments but not provided. ` +
        `paymentMethod=${payload.paymentMethod} requires bankId field.`
      );
    }

    // Map local bank ID to QB bank account ID
    depositToAccountQbId = await EntityMappingService.getQbId(
      organizationId,
      'bank',
      payload.bankId
    );

    if (!depositToAccountQbId) {
      throw new Error(
        `Bank account mapping not found: localId=${payload.bankId}. ` +
        `Please create bank mapping via /api/quickbooks/mappings before syncing card transactions.`
      );
    }
  }

  // 3. Map line items to QB format (with item mapping lookups)
  const lines = [];

  for (const item of payload.lineItems) {
    // Resolve item mapping (fuel type → QB Item)
    const itemQbId = await EntityMappingService.getQbId(
      organizationId,
      'item',
      item.fuelTypeId
    );

    if (!itemQbId) {
      throw new Error(
        `Item mapping not found: localId=${item.fuelTypeId} (${item.fuelTypeName}). ` +
        `Please create mapping via /api/quickbooks/mappings before syncing.`
      );
    }

    lines.push({
      Amount: item.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: {
          value: itemQbId // Use QB Item ID (not name)
        },
        Qty: item.quantity,
        UnitPrice: item.unitPrice
      },
      Description: `${item.fuelTypeName} - ${item.quantity}L @ ${item.unitPrice}/L`
    });
  }

  // 4. Add tax line if applicable (using tax item mapping)
  if (payload.taxAmount && payload.taxAmount > 0) {
    const taxItemQbId = await EntityMappingService.getQbId(
      organizationId,
      'item',
      'tax'
    );

    if (!taxItemQbId) {
      throw new Error(
        `Tax item mapping not found: localId=tax. ` +
        `Please create mapping via /api/quickbooks/mappings before syncing.`
      );
    }

    lines.push({
      Amount: payload.taxAmount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: {
          value: taxItemQbId
        },
        Qty: 1,
        UnitPrice: payload.taxAmount
      },
      Description: 'Sales Tax'
    });
  }

  // 5. Build final SalesReceipt payload
  const salesReceiptPayload: any = {
    TxnDate: payload.txnDate,
    PrivateNote: `Kuwait POS Sale #${payload.saleId}`,
    CustomerRef: {
      value: customerQbId
    },
    Line: lines,
    TotalAmt: payload.totalAmount,
    PaymentMethodRef: {
      value: paymentMethodQbId
    }
  };

  // Add bank deposit account for card payments
  if (depositToAccountQbId) {
    salesReceiptPayload.DepositToAccountRef = {
      value: depositToAccountQbId
    };
  }

  return salesReceiptPayload;
}

/**
 * Get QuickBooks API base URL based on environment
 */
function getQuickBooksApiUrl(realmId: string): string {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return environment === 'production' ? QB_PRODUCTION_API : QB_SANDBOX_API;
}
