/**
 * QuickBooks Purchase/Bill Handler (S9, S10)
 *
 * Posts a POS purchase order (tanker receipt or GRN) to QB as a Bill with
 * ItemBasedExpenseLineDetail rows. Each line references a mapped Inventory
 * Item (HSD / PMG / specific non-fuel SKU), NOT an expense account — this is
 * what lets QB automatically:
 *   Dr Inventory Asset (child item rolls into parent)
 *   Cr Accounts Payable (via VendorRef → Trade Payables)
 *
 * The previous implementation used AccountBasedExpenseLineDetail with
 * `fuel_<uuid>` / `product_<uuid>` expense-account mappings, which posted
 * directly to an expense line and skipped the Inventory Asset cycle —
 * contradicting S9/S10 and leaving QB's perpetual inventory stale.
 */

import { QBSyncQueue } from '@prisma/client';
import { getValidAccessToken as getValidToken } from '../token-refresh';
import { AuditLogger } from '../audit-logger';
import { checkKillSwitch, checkSyncMode } from '../safety-gates';
import { CompanyLock } from '../company-lock';
import { EntityMappingService } from '../entity-mapping.service';
import { classifyError, logClassifiedError, OpLog } from '../error-classifier';
import { prisma } from '../../../config/database';
import { getQuickBooksApiUrl, resolveItemMapping } from '../qb-shared';

export interface PurchasePayload {
  purchaseOrderId: string;
  organizationId: string;
  supplierId: string;
  supplierName: string;
  txnDate: string;
  dueDate?: string;
  lineItems: Array<{
    itemType: 'fuel' | 'product';
    fuelTypeId?: string;       // item localId for fuel rows
    fuelTypeName?: string;
    productId?: string;         // item localId for non-fuel rows
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

export async function handlePurchaseCreate(
  job: QBSyncQueue,
  payload: PurchasePayload
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    validatePayload(payload);

    if (payload.organizationId !== job.organizationId) {
      throw new Error(
        `Organization mismatch: payload=${payload.organizationId}, job=${job.organizationId}`
      );
    }

    await checkKillSwitch(job.organizationId);
    const syncMode = await checkSyncMode(job.organizationId);

    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId: job.organizationId, isActive: true },
    });
    if (!connection) throw new Error('QuickBooks not connected for this organization');

    await CompanyLock.validateRealmId(connection.id, connection.realmId);
    await CompanyLock.lockConnectionToOrganization(connection.id, job.organizationId);

    const { accessToken } = await getValidToken(job.organizationId, prisma);
    const billPayload = await buildBillPayload(job.organizationId, payload);

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
          note: 'Dry-run mode: No QB API call made',
        },
      });

      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN' };
    }

    console.log(`[QB Handler][FULL_SYNC] Creating Bill for PO ${payload.purchaseOrderId}`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/bill?minorversion=65`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(billPayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = (await response.json()) as any;
    const bill = responseData.Bill;
    const duration = Date.now() - startTime;

    await prisma.purchaseOrder.update({
      where: { id: payload.purchaseOrderId },
      data: { qbBillId: bill.Id, qbSynced: true },
    });

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
        durationMs: duration,
        lineStyle: 'ItemBasedExpenseLineDetail',
      },
    });

    return { success: true, qbId: bill.Id, qbDocNumber: bill.DocNumber };
  } catch (error) {
    const duration = Date.now() - startTime;
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));
    console.error(OpLog.qbWriteFail('CREATE_BILL', payload.purchaseOrderId, classified.category));
    logClassifiedError(error instanceof Error ? error : String(error));

    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true },
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
        recommendedAction: classified.action,
      },
    });

    throw error;
  }
}

function validatePayload(payload: PurchasePayload): void {
  if (!payload.purchaseOrderId) throw new Error('Missing required field: purchaseOrderId');
  if (!payload.organizationId) throw new Error('Missing required field: organizationId');
  if (!payload.supplierId) throw new Error('Missing required field: supplierId');
  if (!payload.txnDate) throw new Error('Missing required field: txnDate');
  if (!payload.lineItems || payload.lineItems.length === 0) {
    throw new Error('Missing required field: lineItems (must have at least 1 item)');
  }
  if (payload.totalAmount === undefined || payload.totalAmount < 0) {
    throw new Error('Invalid totalAmount');
  }
  payload.lineItems.forEach((item, index) => {
    if (!item.itemType) throw new Error(`Line item ${index}: Missing itemType`);
    if (item.itemType === 'fuel' && !item.fuelTypeId) {
      throw new Error(`Line item ${index}: Fuel row missing fuelTypeId (item localId)`);
    }
    if (item.itemType === 'product' && !item.productId) {
      throw new Error(`Line item ${index}: Product row missing productId (item localId)`);
    }
    if (item.quantity === undefined || item.quantity <= 0) throw new Error(`Line item ${index}: Invalid quantity`);
    if (item.costPerUnit === undefined || item.costPerUnit < 0) throw new Error(`Line item ${index}: Invalid costPerUnit`);
    if (item.amount === undefined || item.amount < 0) throw new Error(`Line item ${index}: Invalid amount`);
  });
}

async function buildBillPayload(organizationId: string, payload: PurchasePayload): Promise<any> {
  // Vendor
  const vendorQbId = await EntityMappingService.getQbId(organizationId, 'vendor', payload.supplierId);
  if (!vendorQbId) {
    throw new Error(
      `Vendor mapping not found: supplierId=${payload.supplierId}. ` +
      `Sync supplier to QuickBooks first or create mapping (entityType: vendor, localId: ${payload.supplierId}).`
    );
  }

  // Trade Payables — forced APAccountRef so every Bill credits the same A/P
  // account regardless of whether the vendor has a QB default. Required by
  // accountant's S9/S10 spec ("PSO bill → Trade Payables").
  const apAccountQbId = await EntityMappingService.getQbId(organizationId, 'account', 'trade-payables');
  if (!apAccountQbId) {
    throw new Error(
      "Trade Payables account mapping not found. " +
      "Create mapping (entityType: account, localId: 'trade-payables') pointing at QB Accounts Payable. " +
      "Workbook spec requires every Bill to credit Trade Payables."
    );
  }

  // Lines — ItemBasedExpenseLineDetail referencing the mapped Inventory Item
  // so QB posts to Inventory Asset + A/P (workbook S9/S10). Per-product QB
  // Item routing mirrors the sale handler: if products.qb_item_id is set
  // we use that QB id directly; otherwise fall back to the 'non-fuel-item'
  // alias. Fuel-type UUIDs keep their per-type mappings.
  const lines: any[] = [];
  for (const item of payload.lineItems) {
    const rawLocalId = item.itemType === 'fuel' ? item.fuelTypeId! : item.productId!;
    const resolved = await resolveItemMapping(prisma, rawLocalId);
    let itemQbId: string | null;
    if ('qbItemId' in resolved) {
      itemQbId = resolved.qbItemId;
    } else {
      itemQbId = await EntityMappingService.getQbId(organizationId, 'item', resolved.localId);
      if (!itemQbId) {
        throw new Error(
          `Item mapping not found for purchase line: localId=${resolved.localId} (${item.fuelTypeName || item.productName || '?'}). ` +
          `Create mapping (entityType: item, localId: ${resolved.localId}) pointing at the QB Inventory item.`
        );
      }
    }
    lines.push({
      Amount: item.amount,
      DetailType: 'ItemBasedExpenseLineDetail',
      ItemBasedExpenseLineDetail: {
        ItemRef: { value: itemQbId },
        Qty: item.quantity,
        UnitPrice: item.costPerUnit,
      },
      Description: item.description || `${item.fuelTypeName || item.productName} - ${item.quantity} @ ${item.costPerUnit}`,
    });
  }

  const billData: any = {
    VendorRef: { value: vendorQbId },
    APAccountRef: { value: apAccountQbId },
    TxnDate: payload.txnDate,
    Line: lines,
    TotalAmt: payload.totalAmount,
    PrivateNote: `Kuwait POS PO #${payload.poNumber}`,
  };
  if (payload.dueDate) billData.DueDate = payload.dueDate;
  return billData;
}
