/**
 * QuickBooks Bill Payment Handler
 *
 * Converts Kuwait POS supplier payments into QuickBooks Online BillPayments
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

export interface BillPaymentPayload {
  paymentId: string;
  organizationId: string;
  supplierId: string;
  qbBillId: string; // QB Bill ID (from PO sync)
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNumber?: string;
  notes?: string;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  error?: string;
}

/**
 * Main handler for bill payment creation in QuickBooks
 *
 * Flow:
 * 1. Validate payload
 * 2. Check organization isolation
 * 3. Check safety gates
 * 4. Get QB connection
 * 5. Validate company lock
 * 6. Refresh token if expired
 * 7. Build BillPayment JSON
 * 8. POST to QuickBooks API
 * 9. Return result
 */
export async function handleBillPaymentCreate(
  job: QBSyncQueue,
  payload: BillPaymentPayload
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

    // 7. Build BillPayment JSON
    const billPaymentPayload = await buildBillPaymentPayload(job.organizationId, payload);

    // 8. Check if DRY_RUN mode
    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.paymentId,
        'Sync mode is DRY_RUN - simulating success without QB API call'
      ));

      await AuditLogger.log({
        operation: 'CREATE_BILL_PAYMENT_DRY_RUN',
        entity_type: 'supplier_payment',
        entity_id: payload.paymentId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: billPaymentPayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          note: 'Dry-run mode: No actual QB API call made'
        }
      });

      return {
        success: true,
        qbId: 'DRY_RUN'
      };
    }

    // 9. POST to QuickBooks API (FULL_SYNC mode only)
    console.log(`[QB Handler][FULL_SYNC] Creating bill payment for payment ${payload.paymentId}`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/billpayment?minorversion=65`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(billPaymentPayload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = await response.json() as any;
    const billPayment = responseData.BillPayment;

    const duration = Date.now() - startTime;

    // 10. Log success
    console.log(OpLog.qbWriteSuccess('CREATE_BILL_PAYMENT', payload.paymentId, billPayment.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_BILL_PAYMENT',
      entity_type: 'supplier_payment',
      entity_id: payload.paymentId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: billPaymentPayload,
      response_payload: billPayment,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: billPayment.Id,
        durationMs: duration
      }
    });

    return {
      success: true,
      qbId: billPayment.Id
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Classify error
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));

    console.error(OpLog.qbWriteFail('CREATE_BILL_PAYMENT', payload.paymentId, classified.category));
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
      operation: 'CREATE_BILL_PAYMENT',
      entity_type: 'supplier_payment',
      entity_id: payload.paymentId,
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
function validatePayload(payload: BillPaymentPayload): void {
  if (!payload.paymentId) {
    throw new Error('Missing required field: paymentId');
  }
  if (!payload.organizationId) {
    throw new Error('Missing required field: organizationId');
  }
  if (!payload.supplierId) {
    throw new Error('Missing required field: supplierId');
  }
  if (!payload.qbBillId) {
    throw new Error('Missing required field: qbBillId (Bill must be synced to QB first)');
  }
  if (!payload.paymentDate) {
    throw new Error('Missing required field: paymentDate');
  }
  if (payload.amount === undefined || payload.amount <= 0) {
    throw new Error('Invalid amount: must be greater than 0');
  }
  if (!payload.paymentMethod) {
    throw new Error('Missing required field: paymentMethod');
  }
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
 * Build QuickBooks BillPayment JSON payload
 * Uses EntityMappingService to resolve QB entity IDs
 */
async function buildBillPaymentPayload(
  organizationId: string,
  payload: BillPaymentPayload
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
      `Please sync supplier to QuickBooks first.`
    );
  }

  // 2. Resolve bank account mapping (where payment comes from)
  let bankAccountQbId = await EntityMappingService.getQbId(
    organizationId,
    'bank_account',
    payload.paymentMethod.toLowerCase()
  );

  if (!bankAccountQbId) {
    // Fallback to default checking account
    bankAccountQbId = await EntityMappingService.getQbId(
      organizationId,
      'bank_account',
      'default_checking'
    );

    if (!bankAccountQbId) {
      throw new Error(
        `Bank account mapping not found: localId=${payload.paymentMethod}. ` +
        `Please create mapping (entityType: bank_account, localId: ${payload.paymentMethod}) or default_checking.`
      );
    }
  }

  // 3. Build BillPayment payload
  const billPaymentData: any = {
    VendorRef: {
      value: vendorQbId
    },
    PayType: 'Check', // Default to Check, can be made configurable
    TxnDate: payload.paymentDate,
    TotalAmt: payload.amount,
    CheckPayment: {
      BankAccountRef: {
        value: bankAccountQbId
      }
    },
    Line: [
      {
        Amount: payload.amount,
        LinkedTxn: [
          {
            TxnId: payload.qbBillId,
            TxnType: 'Bill'
          }
        ]
      }
    ]
  };

  if (payload.referenceNumber) {
    billPaymentData.DocNumber = payload.referenceNumber;
  }

  if (payload.notes) {
    billPaymentData.PrivateNote = payload.notes;
  }

  return billPaymentData;
}

/**
 * Get QuickBooks API base URL
 */
function getQuickBooksApiUrl(realmId: string): string {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return environment === 'production' ? QB_PRODUCTION_API : QB_SANDBOX_API;
}
