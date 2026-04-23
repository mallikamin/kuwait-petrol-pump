/**
 * QuickBooks PSO Card Settlement Handler (S8C — workbook spec-compliant).
 *
 * Scenario: a credit customer pays an outstanding Invoice using their PSO
 * Fleet Card. Cash isn't actually settled at the pump — PSO remits later —
 * so the AR must transfer from the original customer to PSO:
 *
 *   Dr  Accounts Receivable   (Entity = pso-card-receivable customer)
 *   Cr  Accounts Receivable   (Entity = original credit customer)
 *
 * Both lines sit on the same A/R account (QB id 94 in this realm),
 * differentiated by Entity on each JournalEntryLineDetail — that's QB's
 * native pattern for customer-to-customer AR transfers and keeps the trial
 * balance untouched.
 *
 * Then, for each allocated original Invoice, a zero-dollar Payment is
 * posted on the original customer linking the Invoice to the JE credit
 * line, so QB shows the Invoice as Paid rather than leaving it open with
 * a negative customer balance.
 *
 * Required mappings (all already seeded in prod):
 *   account/accounts-receivable        → QB A/R (94)
 *   customer/pso-card-receivable       → QB "PSO Card Receivables" (55)
 *   customer/<customerUuid>            → original customer (auto-created)
 *
 * Job: (entityType='customer_receipt', jobType='create_pso_card_ar_transfer_journal')
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

export interface PsoCardSettlementPayload {
  receiptId: string;               // CustomerReceipt.id
  organizationId: string;
  customerId: string;              // original credit customer (e.g. BPO Ltd)
  txnDate: string;                 // 'YYYY-MM-DD'
  totalAmount: number;             // PKR total of the settlement
  /**
   * One entry per Invoice this PSO-card settlement clears. Amount sums
   * must equal totalAmount. qbInvoiceId is the original Sale.qbInvoiceId.
   */
  allocations: Array<{
    qbInvoiceId: string;
    amount: number;
  }>;
  referenceNumber?: string;
  notes?: string;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

async function qbRequest(
  method: 'POST' | 'GET',
  qbApiUrl: string,
  realmId: string,
  pathSuffix: string,
  accessToken: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${qbApiUrl}/v3/company/${realmId}/${pathSuffix}?minorversion=65`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

export async function handlePsoCardSettlement(
  job: QBSyncQueue,
  payload: PsoCardSettlementPayload,
): Promise<JobResult> {
  const startTime = Date.now();
  const operation = 'CREATE_PSO_CARD_SETTLEMENT';

  try {
    validatePayload(payload);

    if (payload.organizationId !== job.organizationId) {
      throw new Error(`Organization mismatch: payload=${payload.organizationId}, job=${job.organizationId}`);
    }

    await checkKillSwitch(job.organizationId);
    const syncMode = await checkSyncMode(job.organizationId);

    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId: job.organizationId, isActive: true },
    });
    if (!connection) throw new Error('QuickBooks not connected for this organization');

    await CompanyLock.validateRealmId(connection.id, connection.realmId);
    await CompanyLock.lockConnectionToOrganization(connection.id, job.organizationId);

    // Resolve QB IDs. ensureCustomerMapping auto-creates the original customer
    // in QB if a mapping is missing — same pattern as ReceivePayment/Advance
    // handlers. pso-card-receivable and accounts-receivable must be pre-seeded
    // by admin bootstrap.
    await ensureCustomerMapping(job.organizationId, payload.customerId);
    const origCustomerQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', payload.customerId);
    if (!origCustomerQbId) throw new Error(`Customer mapping missing for ${payload.customerId}`);

    await ensureCustomerMapping(job.organizationId, 'pso-card-receivable');
    const psoCustomerQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', 'pso-card-receivable');
    if (!psoCustomerQbId) throw new Error('Missing mapping: customer/pso-card-receivable');

    const arAcctId = await EntityMappingService.getQbId(job.organizationId, 'account', 'accounts-receivable');
    if (!arAcctId) throw new Error('Missing mapping: account/accounts-receivable');

    const jePayload = {
      TxnDate: payload.txnDate,
      DocNumber: `PSO-${payload.receiptId.slice(0, 8)}`,
      PrivateNote:
        `Kuwait POS PSO-Card settlement — receipt ${payload.receiptId}` +
        (payload.referenceNumber ? ` — ref ${payload.referenceNumber}` : '') +
        (payload.notes ? ` — ${payload.notes}` : ''),
      Line: [
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.totalAmount,
          Description: 'PSO Card Receivable — AR transfer from credit customer',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: arAcctId },
            Entity: { Type: 'Customer', EntityRef: { value: psoCustomerQbId } },
          },
        },
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.totalAmount,
          Description: 'Original customer AR cleared via PSO Card settlement',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: arAcctId },
            Entity: { Type: 'Customer', EntityRef: { value: origCustomerQbId } },
          },
        },
      ],
    };

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(payload.receiptId, 'DRY_RUN — PSO-Card settlement JE'));
      await AuditLogger.log({
        operation: `${operation}_DRY_RUN`,
        entity_type: 'customer_receipt',
        entity_id: payload.receiptId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: jePayload,
        metadata: { jobId: job.id, syncMode: 'DRY_RUN', durationMs: Date.now() - startTime },
      });
      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN' };
    }

    const { accessToken } = await getValidToken(job.organizationId, prisma);
    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);

    // 1) Post the JE (AR transfer)
    const jeResp = await qbRequest('POST', qbApiUrl, connection.realmId, 'journalentry', accessToken, jePayload);
    if (jeResp.status !== 200 || !jeResp.body?.JournalEntry?.Id) {
      throw new Error(`QB JournalEntry POST failed: ${jeResp.status} ${JSON.stringify(jeResp.body).slice(0, 500)}`);
    }
    const je = jeResp.body.JournalEntry;
    console.log(`[PSO settlement] JE created: ${je.Id}`);

    // 2) For each allocated Invoice, post a zero-dollar Payment on the
    //    ORIGINAL customer that applies the JE credit line to the Invoice.
    //    QB's Payment endpoint accepts LinkedTxn.TxnType='JournalEntry', so
    //    the Invoice moves from Open to Paid without any cash movement.
    const paymentIds: string[] = [];
    const paymentErrors: string[] = [];
    for (const alloc of payload.allocations) {
      const paymentBody: any = {
        CustomerRef: { value: origCustomerQbId },
        TxnDate: payload.txnDate,
        TotalAmt: 0,
        PrivateNote: `PSO-Card settlement application — JE ${je.Id}`,
        Line: [
          {
            Amount: alloc.amount,
            LinkedTxn: [{ TxnId: alloc.qbInvoiceId, TxnType: 'Invoice' }],
          },
          {
            Amount: -alloc.amount,
            LinkedTxn: [{ TxnId: je.Id, TxnType: 'JournalEntry' }],
          },
        ],
      };
      const payResp = await qbRequest('POST', qbApiUrl, connection.realmId, 'payment', accessToken, paymentBody);
      if (payResp.status === 200 && payResp.body?.Payment?.Id) {
        paymentIds.push(payResp.body.Payment.Id);
        console.log(`[PSO settlement] $0 Payment ${payResp.body.Payment.Id} linked Invoice ${alloc.qbInvoiceId} ↔ JE ${je.Id}`);
      } else {
        // A failed application is non-fatal: JE already reduced the customer
        // balance to 0. Accountant can match in QB UI. Log for audit.
        const errSnip = JSON.stringify(payResp.body).slice(0, 400);
        paymentErrors.push(`Invoice ${alloc.qbInvoiceId}: ${payResp.status} ${errSnip}`);
        console.warn(`[PSO settlement] $0 Payment application failed for Invoice ${alloc.qbInvoiceId}: ${errSnip}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess(operation, payload.receiptId, je.Id, duration));

    await AuditLogger.log({
      operation,
      entity_type: 'customer_receipt',
      entity_id: payload.receiptId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: jePayload,
      response_payload: je,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbJournalEntryId: je.Id,
        qbPaymentIds: paymentIds,
        paymentApplicationErrors: paymentErrors,
        durationMs: duration,
        originalCustomerQbId: origCustomerQbId,
        psoCardQbId: psoCustomerQbId,
        allocations: payload.allocations.length,
        totalAmount: payload.totalAmount,
      },
    });

    return { success: true, qbId: je.Id, qbDocNumber: je.DocNumber };
  } catch (err) {
    const duration = Date.now() - startTime;
    const classified = classifyError(err instanceof Error ? err : new Error(String(err)));
    console.error(OpLog.qbWriteFail(operation, payload.receiptId, classified.category));
    logClassifiedError(err instanceof Error ? err : String(err));

    let syncMode = 'UNKNOWN';
    try {
      const connection = await prisma.qBConnection.findFirst({
        where: { organizationId: job.organizationId, isActive: true },
        select: { syncMode: true },
      });
      syncMode = connection?.syncMode || 'UNKNOWN';
    } catch { /* ignore */ }

    await AuditLogger.log({
      operation,
      entity_type: 'customer_receipt',
      entity_id: payload.receiptId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: err instanceof Error ? err.message : String(err),
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

    throw err;
  }
}

function validatePayload(p: PsoCardSettlementPayload): void {
  if (!p.receiptId) throw new Error('Missing required field: receiptId');
  if (!p.organizationId) throw new Error('Missing required field: organizationId');
  if (!p.customerId) throw new Error('Missing required field: customerId');
  if (!p.txnDate) throw new Error('Missing required field: txnDate');
  if (!(p.totalAmount > 0)) throw new Error(`Invalid totalAmount: ${p.totalAmount}. Must be > 0.`);
  if (!Array.isArray(p.allocations) || p.allocations.length === 0) {
    throw new Error('PSO-Card settlement requires at least one allocation');
  }
  for (const a of p.allocations) {
    if (!a.qbInvoiceId) throw new Error('Each allocation needs qbInvoiceId');
    if (!(a.amount > 0)) throw new Error(`Allocation amount must be > 0 (got ${a.amount})`);
  }
  const allocSum = p.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - p.totalAmount) > 0.01) {
    throw new Error(
      `Allocation sum ${allocSum.toFixed(2)} does not match totalAmount ${p.totalAmount.toFixed(2)}`,
    );
  }
}
