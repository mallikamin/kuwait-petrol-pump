/**
 * QuickBooks Vendor Handler
 *
 * Converts Kuwait POS suppliers into QuickBooks Online Vendors
 * Implements full OAuth token refresh, error handling, and audit logging
 */

import { QBSyncQueue } from '@prisma/client';
import { encryptToken } from '../encryption';
import { getValidAccessToken as getValidToken } from '../token-refresh';
import { AuditLogger } from '../audit-logger';
import { checkKillSwitch, checkSyncMode } from '../safety-gates';
import { CompanyLock } from '../company-lock';
import { classifyError, logClassifiedError, OpLog } from '../error-classifier';
import { prisma } from '../../../config/database';

// QuickBooks OAuth2 endpoints
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com';
const QB_PRODUCTION_API = 'https://quickbooks.api.intuit.com';

export interface VendorPayload {
  supplierId: string;
  organizationId: string;
  displayName: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  creditDays?: number;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  error?: string;
}

/**
 * Main handler for vendor creation in QuickBooks
 *
 * Flow:
 * 1. Validate payload
 * 2. Check organization isolation
 * 3. Check safety gates (kill switch, sync mode)
 * 4. Get QB connection
 * 5. Validate company lock
 * 6. Refresh token if expired
 * 7. Build Vendor JSON
 * 8. POST to QuickBooks API
 * 9. Save entity mapping
 * 10. Return result
 */
export async function handleVendorCreate(
  job: QBSyncQueue,
  payload: VendorPayload
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

    // 5. Validate company lock
    await CompanyLock.validateRealmId(connection.id, connection.realmId);
    await CompanyLock.lockConnectionToOrganization(connection.id, job.organizationId);

    // 6. Refresh token if expired
    const { accessToken } = await getValidToken(job.organizationId, prisma);

    // 7. Build Vendor JSON
    const vendorPayload = buildVendorPayload(payload);

    // 8. Check if DRY_RUN mode
    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.supplierId,
        'Sync mode is DRY_RUN - simulating success without QB API call'
      ));

      await AuditLogger.log({
        operation: 'CREATE_VENDOR_DRY_RUN',
        entity_type: 'supplier',
        entity_id: payload.supplierId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: vendorPayload,
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
    console.log(`[QB Handler][FULL_SYNC] Creating vendor for supplier ${payload.supplierId}`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/vendor?minorversion=65`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(vendorPayload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = await response.json() as any;
    const vendor = responseData.Vendor;

    const duration = Date.now() - startTime;

    // 10. Save entity mapping (supplier → vendor)
    await prisma.qBEntityMapping.upsert({
      where: {
        uq_qb_mapping_org_type_local: {
          organizationId: job.organizationId,
          entityType: 'vendor',
          localId: payload.supplierId
        }
      },
      create: {
        organizationId: job.organizationId,
        entityType: 'vendor',
        localId: payload.supplierId,
        qbId: vendor.Id,
        qbName: vendor.DisplayName
      },
      update: {
        qbId: vendor.Id,
        qbName: vendor.DisplayName
      }
    });

    // 11. Update supplier with QB ID
    await prisma.supplier.update({
      where: { id: payload.supplierId },
      data: {
        qbVendorId: vendor.Id,
        qbSynced: true
      }
    });

    // 12. Log success
    console.log(OpLog.qbWriteSuccess('CREATE_VENDOR', payload.supplierId, vendor.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_VENDOR',
      entity_type: 'supplier',
      entity_id: payload.supplierId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: vendorPayload,
      response_payload: vendor,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: vendor.Id,
        durationMs: duration
      }
    });

    return {
      success: true,
      qbId: vendor.Id
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Classify error
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));

    console.error(OpLog.qbWriteFail('CREATE_VENDOR', payload.supplierId, classified.category));
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
      operation: 'CREATE_VENDOR',
      entity_type: 'supplier',
      entity_id: payload.supplierId,
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
function validatePayload(payload: VendorPayload): void {
  if (!payload.supplierId) {
    throw new Error('Missing required field: supplierId');
  }
  if (!payload.organizationId) {
    throw new Error('Missing required field: organizationId');
  }
  if (!payload.displayName) {
    throw new Error('Missing required field: displayName');
  }
}

/**
 * Build QuickBooks Vendor JSON payload
 */
function buildVendorPayload(payload: VendorPayload): any {
  const vendorData: any = {
    DisplayName: payload.displayName
  };

  if (payload.companyName) {
    vendorData.CompanyName = payload.companyName;
  }

  if (payload.firstName || payload.lastName) {
    vendorData.GivenName = payload.firstName;
    vendorData.FamilyName = payload.lastName;
  }

  if (payload.phone) {
    vendorData.PrimaryPhone = {
      FreeFormNumber: payload.phone
    };
  }

  if (payload.email) {
    vendorData.PrimaryEmailAddr = {
      Address: payload.email
    };
  }

  if (payload.paymentTerms) {
    vendorData.TermRef = {
      name: payload.paymentTerms
    };
  }

  return vendorData;
}

/**
 * Get QuickBooks API base URL
 */
function getQuickBooksApiUrl(realmId: string): string {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return environment === 'production' ? QB_PRODUCTION_API : QB_SANDBOX_API;
}
