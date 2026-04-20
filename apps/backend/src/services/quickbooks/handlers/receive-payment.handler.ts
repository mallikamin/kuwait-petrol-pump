/**
 * QuickBooks Receive Payment Handler (S8)
 *
 * Posts a customer receipt — cash or bank — against an open invoice in QB.
 * Scenario mapping:
 *   Option A — Cash tendered at counter
 *     DepositToAccount = mapped cash-in-hand bank_account
 *   Option B — Bank transfer / IBFT / cheque / online card clearance
 *     DepositToAccount = mapped bank (ABL, BOP Sundar, Faysal, MCB, ...)
 *
 * The payload must carry `qbInvoiceId` — the QB ID of the invoice the payment
 * is being applied to (captured when the original credit sale synced). The
 * handler posts a QB ReceivePayment with a single LinkedTxn of type Invoice.
 *
 * Deposit-account resolution uses entityType='bank_account' with these localId
 * conventions (documented in qb-shared.ts too):
 *   'cash'              → cash in hand
 *   'default_checking'  → generic bank fallback when no specific bank was given
 *   <bank.id UUID>      → a specific bank for bank transfers / cheque clearance
 */

import { QBSyncQueue } from '@prisma/client';
import { getValidAccessToken as getValidToken } from '../token-refresh';
import { AuditLogger } from '../audit-logger';
import { checkKillSwitch, checkSyncMode } from '../safety-gates';
import { CompanyLock } from '../company-lock';
import { EntityMappingService } from '../entity-mapping.service';
import { classifyError, logClassifiedError, OpLog } from '../error-classifier';
import { prisma } from '../../../config/database';
import { getQuickBooksApiUrl } from '../qb-shared';
import { ensureCustomerMapping } from '../ensure-customer-mapping';

export interface ReceivePaymentPayload {
  receiptId: string;           // CustomerReceipt.id (our source row)
  organizationId: string;
  customerId: string;          // POS customer UUID (mapped via entityType='customer')
  qbInvoiceId: string;         // QB Invoice.Id the payment applies to
  paymentDate: string;         // 'YYYY-MM-DD'
  amount: number;
  /**
   * One of: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'card'.
   * Only used to decide deposit-account localId when no explicit bankId is
   * carried. If the caller passes bankId, we route cash/cheque/transfer/card
   * to that bank; otherwise we fall back to 'cash' vs 'default_checking'.
   */
  paymentChannel: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'card';
  bankId?: string;             // optional — specific bank for non-cash channels
  referenceNumber?: string;    // cheque# or bank advice# — becomes QB DocNumber
  notes?: string;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

export async function handleReceivePaymentCreate(
  job: QBSyncQueue,
  payload: ReceivePaymentPayload
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
    const receivePaymentPayload = await buildReceivePaymentPayload(job.organizationId, payload);

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.receiptId,
        'Sync mode is DRY_RUN - would POST ReceivePayment without QB API call'
      ));

      await AuditLogger.log({
        operation: 'CREATE_RECEIVE_PAYMENT_DRY_RUN',
        entity_type: 'customer_payment',
        entity_id: payload.receiptId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: receivePaymentPayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          paymentChannel: payload.paymentChannel,
          note: 'Dry-run mode: No QB API call made',
        },
      });

      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN' };
    }

    console.log(`[QB Handler][FULL_SYNC] Creating ReceivePayment for receipt ${payload.receiptId} (channel=${payload.paymentChannel})`);

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/payment?minorversion=65`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(receivePaymentPayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = (await response.json()) as any;
    const receivePayment = responseData.Payment;
    const duration = Date.now() - startTime;

    console.log(OpLog.qbWriteSuccess('CREATE_RECEIVE_PAYMENT', payload.receiptId, receivePayment.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_RECEIVE_PAYMENT',
      entity_type: 'customer_payment',
      entity_id: payload.receiptId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: receivePaymentPayload,
      response_payload: receivePayment,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: receivePayment.Id,
        qbDocNumber: receivePayment.DocNumber,
        durationMs: duration,
        paymentChannel: payload.paymentChannel,
      },
    });

    return { success: true, qbId: receivePayment.Id, qbDocNumber: receivePayment.DocNumber };
  } catch (error) {
    const duration = Date.now() - startTime;
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));
    console.error(OpLog.qbWriteFail('CREATE_RECEIVE_PAYMENT', payload.receiptId, classified.category));
    logClassifiedError(error instanceof Error ? error : String(error));

    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true },
      });
      syncMode = connection?.syncMode || 'UNKNOWN';
    } catch {
      // Ignore fetch failures during error path.
    }

    await AuditLogger.log({
      operation: 'CREATE_RECEIVE_PAYMENT',
      entity_type: 'customer_payment',
      entity_id: payload.receiptId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        jobId: job.id,
        syncMode,
        durationMs: duration,
        paymentChannel: payload.paymentChannel,
        errorCategory: classified.category,
        errorSeverity: classified.severity,
        isRetryable: classified.isRetryable,
        recommendedAction: classified.action,
      },
    });

    throw error;
  }
}

function validatePayload(payload: ReceivePaymentPayload): void {
  if (!payload.receiptId) throw new Error('Missing required field: receiptId');
  if (!payload.organizationId) throw new Error('Missing required field: organizationId');
  if (!payload.customerId) throw new Error('Missing required field: customerId');
  if (!payload.qbInvoiceId) throw new Error('Missing required field: qbInvoiceId (invoice must be synced to QB first)');
  if (!payload.paymentDate) throw new Error('Missing required field: paymentDate');
  if (payload.amount === undefined || payload.amount <= 0) {
    throw new Error('Invalid amount: must be > 0');
  }
  if (!payload.paymentChannel) throw new Error('Missing required field: paymentChannel');
}

async function buildReceivePaymentPayload(
  organizationId: string,
  payload: ReceivePaymentPayload,
): Promise<any> {
  // 1. Resolve customer — must already be mapped (invoice can't have been synced otherwise).
  await ensureCustomerMapping(organizationId, payload.customerId);
  const customerQbId = await EntityMappingService.getQbId(organizationId, 'customer', payload.customerId);
  if (!customerQbId) {
    throw new Error(
      `Customer mapping not found for receipt: localId=${payload.customerId}. ` +
      `The customer's invoice must have been synced before a payment can be posted.`
    );
  }

  // 2. Resolve deposit account. Prefer an explicit bank for non-cash channels;
  //    fall back to canonical localIds ('cash' / 'default_checking').
  const bankLocalId = pickBankLocalId(payload);
  const bankAccountQbId = await EntityMappingService.getQbId(
    organizationId,
    'bank_account',
    bankLocalId,
  );
  if (!bankAccountQbId) {
    throw new Error(
      `Bank account mapping not found for receipt: localId=${bankLocalId}. ` +
      `Create mapping (entityType: bank_account, localId: ${bankLocalId}) pointing at the QB deposit account.`
    );
  }

  // 3. Build ReceivePayment (QB entity: Payment). Line[].LinkedTxn ties it to
  //    the open invoice so QB auto-reduces AR on that line.
  const rp: any = {
    TxnDate: payload.paymentDate,
    CustomerRef: { value: customerQbId },
    TotalAmt: payload.amount,
    DepositToAccountRef: { value: bankAccountQbId },
    Line: [
      {
        Amount: payload.amount,
        LinkedTxn: [{ TxnId: payload.qbInvoiceId, TxnType: 'Invoice' }],
      },
    ],
  };
  if (payload.referenceNumber) rp.PaymentRefNum = payload.referenceNumber;
  if (payload.notes) rp.PrivateNote = payload.notes;
  return rp;
}

function pickBankLocalId(payload: ReceivePaymentPayload): string {
  if (payload.paymentChannel === 'cash') return 'cash';
  if (payload.bankId) return payload.bankId; // explicit bank wins
  return 'default_checking';
}
