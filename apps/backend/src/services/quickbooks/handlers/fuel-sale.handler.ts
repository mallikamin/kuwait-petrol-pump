/**
 * QuickBooks Fuel Sale Handler
 *
 * Posts a POS sale to QuickBooks as either:
 *   - SalesReceipt (cash sale — S1/S2/S3)
 *   - Invoice      (AR sale — S4..S7: credit customer, bank-card receivable,
 *                    pso-card receivable, credit_card)
 *
 * Branching is driven by payload.paymentMethod after alias normalization in
 * qb-shared.ts. The handler can be invoked from either dispatcher route
 * (`create_sales_receipt` or `create_invoice`) — both call back here; the
 * payment-method decides which QB endpoint is hit. This keeps all line-item
 * construction and mapping resolution in a single module.
 *
 * COGS + inventory reduction are posted automatically by QB on both
 * SalesReceipt and Invoice when Line[].DetailType === 'SalesItemLineDetail'
 * and the referenced Item is of type 'Inventory' in QB — per the workbook
 * rows labelled "Auto: COGS Recognition" and "Auto: Reduce Inventory" (S1..S7).
 * The handler must therefore reference the mapped inventory Item, not a
 * revenue/COGS account directly.
 */

import { QBSyncQueue } from '@prisma/client';
import { getValidAccessToken as getValidToken } from '../token-refresh';
import { AuditLogger } from '../audit-logger';
import { checkKillSwitch, checkSyncMode } from '../safety-gates';
import { CompanyLock } from '../company-lock';
import { EntityMappingService } from '../entity-mapping.service';
import { classifyError, logClassifiedError, OpLog } from '../error-classifier';
import { prisma } from '../../../config/database';
import {
  getQuickBooksApiUrl,
  normalizePaymentMethod,
  isCashSale,
  isCardSale,
  invoiceCustomerLocalId,
  paymentMethodLocalId,
  PaymentMethod,
} from '../qb-shared';

export interface FuelSalePayload {
  saleId: string;
  organizationId: string;
  customerId?: string;
  bankId?: string; // Required for card payments (deposit-to-account on cash SalesReceipt)
  txnDate: string;
  paymentMethod: string;
  lineItems: Array<{
    fuelTypeId: string; // Item localId — for fuel rows this is the FuelType UUID (or 'HSD'/'PMG')
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
  qbEntity?: 'SalesReceipt' | 'Invoice';
  error?: string;
}

export async function handleFuelSaleCreate(
  job: QBSyncQueue,
  payload: FuelSalePayload
): Promise<JobResult> {
  const startTime = Date.now();
  const method = normalizePaymentMethod(payload.paymentMethod);
  const qbEntity: 'SalesReceipt' | 'Invoice' = isCashSale(method) ? 'SalesReceipt' : 'Invoice';
  const operation = qbEntity === 'SalesReceipt' ? 'CREATE_SALES_RECEIPT' : 'CREATE_INVOICE';

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

    const builtPayload = qbEntity === 'SalesReceipt'
      ? await buildSalesReceiptPayload(job.organizationId, payload, method)
      : await buildInvoicePayload(job.organizationId, payload, method);

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.saleId,
        `Sync mode is DRY_RUN - would POST ${qbEntity} (paymentMethod=${method})`
      ));

      await AuditLogger.log({
        operation: `${operation}_DRY_RUN`,
        entity_type: 'sale',
        entity_id: payload.saleId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: builtPayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          paymentMethod: method,
          qbEntity,
          note: 'Dry-run mode: No QB API call made. Payload validated and simulated success.',
        },
      });

      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN', qbEntity };
    }

    console.log(`[QB Handler][FULL_SYNC] Creating ${qbEntity} for sale ${payload.saleId} (paymentMethod=${method})`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const endpoint = qbEntity === 'SalesReceipt' ? 'salesreceipt' : 'invoice';
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/${endpoint}?minorversion=65`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(builtPayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = (await response.json()) as any;
    const qbRecord = qbEntity === 'SalesReceipt' ? responseData.SalesReceipt : responseData.Invoice;

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess(operation, payload.saleId, qbRecord.Id, duration));

    await AuditLogger.log({
      operation,
      entity_type: 'sale',
      entity_id: payload.saleId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: builtPayload,
      response_payload: qbRecord,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: qbRecord.Id,
        qbDocNumber: qbRecord.DocNumber,
        durationMs: duration,
        paymentMethod: method,
        qbEntity,
      },
    });

    return { success: true, qbId: qbRecord.Id, qbDocNumber: qbRecord.DocNumber, qbEntity };
  } catch (error) {
    const duration = Date.now() - startTime;
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));
    console.error(OpLog.qbWriteFail(operation, payload.saleId, classified.category));
    logClassifiedError(error instanceof Error ? error : String(error));

    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true },
      });
      syncMode = connection?.syncMode || 'UNKNOWN';
    } catch {
      // Ignore errors fetching sync mode during error path.
    }

    await AuditLogger.log({
      operation,
      entity_type: 'sale',
      entity_id: payload.saleId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        jobId: job.id,
        syncMode,
        durationMs: duration,
        paymentMethod: method,
        qbEntity,
        errorCategory: classified.category,
        errorSeverity: classified.severity,
        isRetryable: classified.isRetryable,
        recommendedAction: classified.action,
      },
    });

    throw error;
  }
}

function validatePayload(payload: FuelSalePayload): void {
  if (!payload.saleId) throw new Error('Missing required field: saleId');
  if (!payload.organizationId) throw new Error('Missing required field: organizationId');
  if (!payload.txnDate) throw new Error('Missing required field: txnDate');
  if (!payload.lineItems || payload.lineItems.length === 0) {
    throw new Error('Missing required field: lineItems (must have at least 1 item)');
  }
  if (payload.totalAmount === undefined || payload.totalAmount < 0) {
    throw new Error('Invalid totalAmount');
  }
  payload.lineItems.forEach((item, index) => {
    if (!item.fuelTypeName) throw new Error(`Line item ${index}: Missing fuelTypeName`);
    if (!item.fuelTypeId) throw new Error(`Line item ${index}: Missing fuelTypeId (item localId)`);
    if (item.quantity === undefined || item.quantity <= 0) throw new Error(`Line item ${index}: Invalid quantity`);
    if (item.unitPrice === undefined || item.unitPrice < 0) throw new Error(`Line item ${index}: Invalid unitPrice`);
    if (item.amount === undefined || item.amount < 0) throw new Error(`Line item ${index}: Invalid amount`);
  });
}

/**
 * Build SalesItemLineDetail lines + an optional Tax line. Shared between
 * SalesReceipt and Invoice — the per-line shape is identical in both entities
 * (this is what gives us the automatic COGS + inventory reduction in QB).
 */
async function buildLines(organizationId: string, payload: FuelSalePayload): Promise<any[]> {
  const lines: any[] = [];

  for (const item of payload.lineItems) {
    const itemQbId = await EntityMappingService.getQbId(organizationId, 'item', item.fuelTypeId);
    if (!itemQbId) {
      throw new Error(
        `Item mapping not found: localId=${item.fuelTypeId} (${item.fuelTypeName}). ` +
        `Create mapping via /api/quickbooks/mappings (entityType: item) before syncing.`
      );
    }
    lines.push({
      Amount: item.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: itemQbId },
        Qty: item.quantity,
        UnitPrice: item.unitPrice,
      },
      Description: `${item.fuelTypeName} - ${item.quantity} @ ${item.unitPrice}`,
    });
  }

  if (payload.taxAmount && payload.taxAmount > 0) {
    const taxItemQbId = await EntityMappingService.getQbId(organizationId, 'item', 'tax');
    if (!taxItemQbId) {
      throw new Error(
        `Tax item mapping not found: localId=tax. Create mapping (entityType: item, localId: tax) before syncing taxed sales.`
      );
    }
    lines.push({
      Amount: payload.taxAmount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: taxItemQbId }, Qty: 1, UnitPrice: payload.taxAmount },
      Description: 'Sales Tax',
    });
  }
  return lines;
}

async function resolvePaymentMethodRef(organizationId: string, method: PaymentMethod): Promise<string> {
  // All card-type methods (bank_card/pso_card/credit_card) share QB's
  // "Credit Card" PaymentMethod; the customer routing is what differs (handled
  // by invoiceCustomerLocalId). See paymentMethodLocalId docstring.
  const pmLocalId = paymentMethodLocalId(method);
  const pmQbId = await EntityMappingService.getQbId(organizationId, 'payment_method', pmLocalId);
  if (!pmQbId) {
    throw new Error(
      `Payment method mapping not found: localId=${pmLocalId}. ` +
      `Create mapping (entityType: payment_method, localId: ${pmLocalId}) before syncing.`
    );
  }
  return pmQbId;
}

/**
 * SalesReceipt — for cash (S1..S3). Deposits to mapped Cash-in-Hand, or to
 * the mapped bank when the payload carries a bankId (future-proofing for
 * card-swipe-treated-as-cash flows; primary cash flow does not set bankId).
 */
async function buildSalesReceiptPayload(
  organizationId: string,
  payload: FuelSalePayload,
  method: PaymentMethod,
): Promise<any> {
  const customerLocalId = payload.customerId || 'walk-in';
  const customerQbId = await EntityMappingService.getQbId(organizationId, 'customer', customerLocalId);
  if (!customerQbId) {
    // Distinct message for walk-in so preflight error search / existing tests
    // can differentiate "walk-in customer not mapped" from "real customer not
    // mapped" — they have different admin remediation paths.
    throw new Error(
      customerLocalId === 'walk-in'
        ? `Walk-in customer mapping not found: localId=walk-in. Create mapping (entityType: customer, localId: walk-in).`
        : `Customer mapping not found for cash sale: localId=${customerLocalId}. Create mapping (entityType: customer, localId: ${customerLocalId}).`
    );
  }

  const paymentMethodQbId = await resolvePaymentMethodRef(organizationId, method);

  let depositToAccountQbId: string | undefined;
  if (isCardSale(method)) {
    if (!payload.bankId) {
      throw new Error(
        `Card sale requires bankId for DepositToAccount resolution (paymentMethod=${method}).`
      );
    }
    const bankQbId = await EntityMappingService.getQbId(organizationId, 'bank', payload.bankId);
    if (!bankQbId) {
      throw new Error(
        `Bank mapping not found: localId=${payload.bankId}. Create mapping (entityType: bank) before syncing card deposits.`
      );
    }
    depositToAccountQbId = bankQbId;
  } else if (method === 'cash') {
    // Workbook S1–S3: Dr Cash in Hand on cash SalesReceipt. QB deposits to
    // "Undeposited Funds" when DepositToAccountRef is absent — wrong for this CoA.
    const cashQbId = await EntityMappingService.getQbId(organizationId, 'bank_account', 'cash');
    if (!cashQbId) {
      throw new Error(
        'bank_account/cash mapping not found. Create mapping (entityType: bank_account, localId: cash) pointing at QB "Cash in Hand".'
      );
    }
    depositToAccountQbId = cashQbId;
  }

  const lines = await buildLines(organizationId, payload);

  const srPayload: any = {
    TxnDate: payload.txnDate,
    PrivateNote: `Kuwait POS Sale #${payload.saleId}`,
    CustomerRef: { value: customerQbId },
    Line: lines,
    TotalAmt: payload.totalAmount,
    PaymentMethodRef: { value: paymentMethodQbId },
  };
  if (depositToAccountQbId) srPayload.DepositToAccountRef = { value: depositToAccountQbId };
  return srPayload;
}

/**
 * Invoice — for AR (S4..S7). Customer is the AR counterparty:
 *   credit_customer → real customer UUID
 *   bank_card/credit_card → 'bank-card-receivable'
 *   pso_card → 'pso-card-receivable'
 * PaymentMethodRef is still set so QB can categorise the invoice channel.
 * DepositToAccount is NOT set (no money moved at invoice time — that's S8).
 */
async function buildInvoicePayload(
  organizationId: string,
  payload: FuelSalePayload,
  method: PaymentMethod,
): Promise<any> {
  const customerLocalId = invoiceCustomerLocalId(method, payload.customerId);
  const customerQbId = await EntityMappingService.getQbId(organizationId, 'customer', customerLocalId);
  if (!customerQbId) {
    throw new Error(
      `Customer mapping not found for Invoice: localId=${customerLocalId}. ` +
      (method === 'credit_customer'
        ? `Create mapping (entityType: customer, localId: <customer.id UUID>) for this credit customer.`
        : method === 'pso_card'
          ? `Create mapping (entityType: customer, localId: pso-card-receivable) pointing at QB "PSO Card Receivables".`
          : `Create mapping (entityType: customer, localId: bank-card-receivable) pointing at QB "Bank Card Receiveable".`)
    );
  }

  const paymentMethodQbId = await resolvePaymentMethodRef(organizationId, method);
  const lines = await buildLines(organizationId, payload);

  const invoice: any = {
    TxnDate: payload.txnDate,
    PrivateNote: `Kuwait POS Sale #${payload.saleId}`,
    CustomerRef: { value: customerQbId },
    Line: lines,
    TotalAmt: payload.totalAmount,
    PaymentMethodRef: { value: paymentMethodQbId },
  };
  return invoice;
}
