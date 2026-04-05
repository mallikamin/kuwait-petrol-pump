/**
 * QuickBooks Purchase/Bill Handler
 *
 * Converts Kuwait POS purchase orders into QuickBooks Online Bills
 * Implements full OAuth token refresh, error handling, and audit logging
 */

import { QBSyncQueue } from '@prisma/client';
import { decryptToken, encryptToken } from '../encryption';
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

export interface PurchasePayload {
  purchaseOrderId: string;
  organizationId: string;
  supplierId: string;
  supplierName: string;
  txnDate: string;
  dueDate?: string;
  lineItems: Array<{
    itemType: 'fuel' | 'product';
    fuelTypeId?: string;
    fuelTypeName?: string;
    productId?: string;
    productName?: string;
    quantity: number;
    costPerUnit: number;
    amount: number;
    description?: string;
  }>;
  totalAmount: number;
  poNumber: string;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

/**
 * Main handler for bill creation in QuickBooks
 *
 * Flow:
 * 1. Validate payload
 * 2. Check organization isolation
 * 3. Check safety gates
 * 4. Get QB connection
 * 5. Validate company lock
 * 6. Refresh token if expired
 * 7. Build Bill JSON (with entity mapping lookups)
 * 8. POST to QuickBooks API
 * 9. Update PO with QB Bill ID
 * 10. Return result
 */
export async function handlePurchaseCreate(
  job: QBSyncQueue,
  payload: PurchasePayload
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

    // 3. Check safety gates
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

    // 5. Validate company lock
    await CompanyLock.validateRealmId(connection.id, connection.realmId);
    await CompanyLock.lockConnectionToOrganization(connection.id, job.organizationId);

    // 6. Refresh token if expired
    const accessToken = await getValidAccessToken(connection);

    // 7. Build Bill JSON
    const billPayload = await buildBillPayload(job.organizationId, payload);

    // 8. Check if DRY_RUN mode
    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.purchaseOrderId,
        'Sync mode is DRY_RUN - simulating success without QB API call'
      ));

      await AuditLogger.log({
        operation: 'CREATE_BILL_DRY_RUN',
        entity_type: 'purchase_order',
        entity_id: payload.purchaseOrderId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: billPayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          note: 'Dry-run mode: No actual QB API call made'
        }
      });

      return {
        success: true,
        qbId: 'DRY_RUN',
        qbDocNumber: 'DRY_RUN'
      };
    }

    // 9. POST to QuickBooks API (FULL_SYNC mode only)
    console.log(`[QB Handler][FULL_SYNC] Creating bill for PO ${payload.purchaseOrderId}`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/bill?minorversion=65`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(billPayload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = await response.json() as any;
    const bill = responseData.Bill;

    const duration = Date.now() - startTime;

    // 10. Update PO with QB Bill ID
    await prisma.purchaseOrder.update({
      where: { id: payload.purchaseOrderId },
      data: {
        qbBillId: bill.Id,
        qbSynced: true
      }
    });

    // 11. Log success
    console.log(OpLog.qbWriteSuccess('CREATE_BILL', payload.purchaseOrderId, bill.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_BILL',
      entity_type: 'purchase_order',
      entity_id: payload.purchaseOrderId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: billPayload,
      response_payload: bill,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: bill.Id,
        qbDocNumber: bill.DocNumber,
        durationMs: duration
      }
    });

    return {
      success: true,
      qbId: bill.Id,
      qbDocNumber: bill.DocNumber
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Classify error
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));

    console.error(OpLog.qbWriteFail('CREATE_BILL', payload.purchaseOrderId, classified.category));
    logClassifiedError(error instanceof Error ? error : String(error));

    // Log failure
    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true }
      });
      syncMode = connection?.syncMode || 'UNKNOWN';
    } catch {
      // Ignore
    }

    await AuditLogger.log({
      operation: 'CREATE_BILL',
      entity_type: 'purchase_order',
      entity_id: payload.purchaseOrderId,
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
 * Validate required fields
 */
function validatePayload(payload: PurchasePayload): void {
  if (!payload.purchaseOrderId) {
    throw new Error('Missing required field: purchaseOrderId');
  }
  if (!payload.organizationId) {
    throw new Error('Missing required field: organizationId');
  }
  if (!payload.supplierId) {
    throw new Error('Missing required field: supplierId');
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
    if (!item.itemType) {
      throw new Error(`Line item ${index}: Missing itemType`);
    }
    if (item.quantity === undefined || item.quantity <= 0) {
      throw new Error(`Line item ${index}: Invalid quantity`);
    }
    if (item.costPerUnit === undefined || item.costPerUnit < 0) {
      throw new Error(`Line item ${index}: Invalid costPerUnit`);
    }
    if (item.amount === undefined || item.amount < 0) {
      throw new Error(`Line item ${index}: Invalid amount`);
    }
  });
}

/**
 * Get valid access token (refresh if expired)
 */
async function getValidAccessToken(connection: any): Promise<string> {
  const now = new Date();
  const expiryBuffer = new Date(connection.accessTokenExpiresAt.getTime() - 5 * 60 * 1000);

  if (now < expiryBuffer) {
    return decryptToken(connection.accessTokenEncrypted);
  }

  // Token expired, refresh it
  console.log(`[QB Handler] Access token expired for connection ${connection.id}, refreshing...`);

  const refreshToken = decryptToken(connection.refreshTokenEncrypted);

  const response = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(
        `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
      ).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const tokenData = await response.json() as any;

  const newAccessTokenEncrypted = encryptToken(tokenData.access_token);
  const newRefreshTokenEncrypted = encryptToken(tokenData.refresh_token);

  await prisma.qBConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: newAccessTokenEncrypted,
      refreshTokenEncrypted: newRefreshTokenEncrypted,
      accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + tokenData.x_refresh_token_expires_in * 1000)
    }
  });

  console.log(`[QB Handler] Access token refreshed successfully`);

  return tokenData.access_token;
}

/**
 * Build QuickBooks Bill JSON payload
 * Uses EntityMappingService to resolve QB entity IDs
 */
async function buildBillPayload(
  organizationId: string,
  payload: PurchasePayload
): Promise<any> {
  // 1. Resolve vendor mapping
  const vendorQbId = await EntityMappingService.getQbId(
    organizationId,
    'vendor',
    payload.supplierId
  );

  if (!vendorQbId) {
    throw new Error(
      `Vendor mapping not found: supplierId=${payload.supplierId}. ` +
      `Please sync supplier to QuickBooks first or create manual mapping.`
    );
  }

  // 2. Map line items to QB format (AccountBasedExpenseLineDetail)
  const lines = [];

  for (const item of payload.lineItems) {
    // Resolve expense account mapping
    let expenseAccountQbId: string | null;

    if (item.itemType === 'fuel' && item.fuelTypeId) {
      // Map fuel type to expense account
      expenseAccountQbId = await EntityMappingService.getQbId(
        organizationId,
        'expense_account',
        `fuel_${item.fuelTypeId}`
      );

      if (!expenseAccountQbId) {
        throw new Error(
          `Expense account mapping not found for fuel type: ${item.fuelTypeName || item.fuelTypeId}. ` +
          `Please create mapping via /api/quickbooks/mappings (entityType: expense_account, localId: fuel_${item.fuelTypeId}).`
        );
      }
    } else if (item.itemType === 'product' && item.productId) {
      // Map product to expense account
      expenseAccountQbId = await EntityMappingService.getQbId(
        organizationId,
        'expense_account',
        `product_${item.productId}`
      );

      if (!expenseAccountQbId) {
        // Fallback to default COGS account
        expenseAccountQbId = await EntityMappingService.getQbId(
          organizationId,
          'expense_account',
          'default_cogs'
        );

        if (!expenseAccountQbId) {
          throw new Error(
            `Expense account mapping not found for product: ${item.productName || item.productId}. ` +
            `Please create mapping (entityType: expense_account, localId: product_${item.productId}) or default_cogs.`
          );
        }
      }
    } else {
      throw new Error(`Invalid line item: missing itemType or IDs`);
    }

    lines.push({
      Amount: item.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: {
          value: expenseAccountQbId
        }
      },
      Description: item.description || `${item.fuelTypeName || item.productName} - ${item.quantity} @ ${item.costPerUnit}`
    });
  }

  // 3. Build final Bill payload
  const billData: any = {
    VendorRef: {
      value: vendorQbId
    },
    TxnDate: payload.txnDate,
    Line: lines,
    TotalAmt: payload.totalAmount,
    PrivateNote: `Kuwait POS PO #${payload.poNumber}`
  };

  if (payload.dueDate) {
    billData.DueDate = payload.dueDate;
  }

  return billData;
}

/**
 * Get QuickBooks API base URL
 */
function getQuickBooksApiUrl(realmId: string): string {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return environment === 'production' ? QB_PRODUCTION_API : QB_SANDBOX_API;
}
