/**
 * QuickBooks Customer Advance Handler
 *
 * Two flows:
 *
 * 1. Deposit (create_advance_deposit_journal)
 *      DR <asset>                          (cash | bank | bank-card-recv | pso-card-recv)
 *      CR Customer Advances (liability)    (Entity=Customer)
 *
 * 2. Cash Handout (create_advance_handout_journal)
 *      DR Customer Advances (liability)    (Entity=Customer)
 *      CR Cash in Hand                     (bank_account/cash mapping)
 *
 * Required QB mappings (seeded by admin once):
 *   account/customer-advance         → QB "Customer Advances" liability
 *   account/accounts-payable         → QB A/P (only used by other handlers)
 *   bank_account/cash                → QB Cash in Hand
 *   customer/bank-card-receivable    → QB "Bank Card Receivables"
 *   customer/pso-card-receivable     → QB "PSO Card Receivables"
 *   bank/<id>                        → QB bank account (for IBFT/bank_card deposits)
 *   customer/<customerUuid>          → QB customer (auto-created on demand by
 *                                      ensureCustomerMapping if missing)
 *
 * For bank_card / pso_card deposits, the DR side targets the receivable
 * customer — same bookkeeping pattern already used by existing fuel sale
 * S6/S7 flows. The credit side hits the per-customer advance liability.
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

export interface AdvanceDepositPayload {
  movementId: string;
  organizationId: string;
  method: 'cash' | 'ibft' | 'bank_card' | 'pso_card';
  amount: number;
  txnDate: string;
  customerId: string;
  bankId: string | null;
  memo: string | null;
}

export interface AdvanceHandoutPayload {
  movementId: string;
  organizationId: string;
  amount: number;
  txnDate: string;
  customerId: string;
  memo: string | null;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

async function postJournalEntry(
  qbApiUrl: string,
  realmId: string,
  accessToken: string,
  jePayload: any,
): Promise<any> {
  const response = await fetch(
    `${qbApiUrl}/v3/company/${realmId}/journalentry?minorversion=65`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jePayload),
    },
  );
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`QB API ${response.status}: ${bodyText.slice(0, 500)}`);
  const body = JSON.parse(bodyText);
  return body?.JournalEntry;
}

export async function handleAdvanceDepositJournal(
  job: QBSyncQueue,
  payload: AdvanceDepositPayload,
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    if (!payload.movementId) throw new Error('Missing movementId');
    if (!payload.amount || payload.amount <= 0) throw new Error('Invalid amount');
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

    // Customer mapping — auto-create if needed (same pattern as credit receipts).
    await ensureCustomerMapping(job.organizationId, payload.customerId);
    const customerQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', payload.customerId);
    if (!customerQbId) throw new Error(`Customer mapping missing for ${payload.customerId}`);

    const advanceAcctId = await EntityMappingService.getQbId(job.organizationId, 'account', 'customer-advance');
    if (!advanceAcctId) throw new Error('Missing mapping: account/customer-advance (QB Customer Advances liability)');

    // DR side asset — depends on method.
    let drAccountId: string;
    let drEntity: any = null;
    if (payload.method === 'cash') {
      drAccountId = (await EntityMappingService.getQbId(job.organizationId, 'bank_account', 'cash')) || '';
      if (!drAccountId) throw new Error('Missing mapping: bank_account/cash');
    } else if (payload.method === 'ibft') {
      if (!payload.bankId) throw new Error('IBFT deposit requires bankId');
      drAccountId = (await EntityMappingService.getQbId(job.organizationId, 'bank_account', payload.bankId)) || '';
      if (!drAccountId) throw new Error(`Missing mapping: bank_account/${payload.bankId}`);
    } else if (payload.method === 'bank_card') {
      // DR Bank Card Receivable customer AR line — routed via account A/R.
      const arAcctId = await EntityMappingService.getQbId(job.organizationId, 'account', 'accounts-receivable');
      if (!arAcctId) throw new Error('Missing mapping: account/accounts-receivable');
      await ensureCustomerMapping(job.organizationId, 'bank-card-receivable');
      const bcrQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', 'bank-card-receivable');
      if (!bcrQbId) throw new Error('Missing mapping: customer/bank-card-receivable');
      drAccountId = arAcctId;
      drEntity = { Type: 'Customer', EntityRef: { value: bcrQbId } };
    } else {
      // pso_card
      const arAcctId = await EntityMappingService.getQbId(job.organizationId, 'account', 'accounts-receivable');
      if (!arAcctId) throw new Error('Missing mapping: account/accounts-receivable');
      await ensureCustomerMapping(job.organizationId, 'pso-card-receivable');
      const psoQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', 'pso-card-receivable');
      if (!psoQbId) throw new Error('Missing mapping: customer/pso-card-receivable');
      drAccountId = arAcctId;
      drEntity = { Type: 'Customer', EntityRef: { value: psoQbId } };
    }

    const jePayload = {
      TxnDate: payload.txnDate,
      Line: [
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: `Customer advance deposit (${payload.method}) — ${payload.memo || 'no memo'}`,
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: drAccountId },
            ...(drEntity ? { Entity: drEntity } : {}),
          },
        },
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: `Customer advance — liability to customer`,
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: advanceAcctId },
            Entity: { Type: 'Customer', EntityRef: { value: customerQbId } },
          },
        },
      ],
      PrivateNote: `Kuwait POS Advance Deposit #${payload.movementId} (${payload.method})${payload.memo ? ` — ${payload.memo}` : ''}`,
    };

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(payload.movementId, 'DRY_RUN — advance deposit'));
      await AuditLogger.log({
        operation: 'CREATE_ADV_DEPOSIT_JE_DRY_RUN',
        entity_type: 'customer_advance',
        entity_id: payload.movementId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: jePayload,
        metadata: { jobId: job.id, durationMs: Date.now() - startTime },
      });
      return { success: true, qbId: 'DRY_RUN' };
    }

    const { accessToken } = await getValidToken(job.organizationId, prisma);
    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const qbRecord = await postJournalEntry(qbApiUrl, connection.realmId, accessToken, jePayload);
    if (!qbRecord?.Id) throw new Error('QB JournalEntry response missing Id');

    await prisma.customerAdvanceMovement.update({
      where: { id: payload.movementId },
      data: { qbSynced: true, qbJournalEntryId: qbRecord.Id, qbSyncedAt: new Date() },
    }).catch((err) =>
      console.warn(`[QB Handler] adv deposit post-sync update failed: ${err instanceof Error ? err.message : String(err)}`),
    );

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess('create_advance_deposit_journal', payload.movementId, qbRecord.Id, duration));
    await AuditLogger.log({
      operation: 'CREATE_ADV_DEPOSIT_JE',
      entity_type: 'customer_advance',
      entity_id: payload.movementId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: jePayload,
      response_payload: qbRecord,
      metadata: { jobId: job.id, method: payload.method, durationMs: duration },
    });
    return { success: true, qbId: qbRecord.Id, qbDocNumber: qbRecord.DocNumber };
  } catch (err: any) {
    const classified = classifyError(err);
    logClassifiedError(err, { operation: 'create_advance_deposit_journal' });
    await AuditLogger.log({
      operation: 'CREATE_ADV_DEPOSIT_JE',
      entity_type: 'customer_advance',
      entity_id: payload.movementId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: err?.message || String(err),
      metadata: { jobId: job.id, errorCategory: classified.category, durationMs: Date.now() - startTime },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

export async function handleAdvanceHandoutJournal(
  job: QBSyncQueue,
  payload: AdvanceHandoutPayload,
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    if (!payload.movementId) throw new Error('Missing movementId');
    if (!payload.amount || payload.amount <= 0) throw new Error('Invalid amount');
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

    await ensureCustomerMapping(job.organizationId, payload.customerId);
    const customerQbId = await EntityMappingService.getQbId(job.organizationId, 'customer', payload.customerId);
    if (!customerQbId) throw new Error(`Customer mapping missing for ${payload.customerId}`);

    const advanceAcctId = await EntityMappingService.getQbId(job.organizationId, 'account', 'customer-advance');
    if (!advanceAcctId) throw new Error('Missing mapping: account/customer-advance');

    const cashAcctId = await EntityMappingService.getQbId(job.organizationId, 'bank_account', 'cash');
    if (!cashAcctId) throw new Error('Missing mapping: bank_account/cash');

    const jePayload = {
      TxnDate: payload.txnDate,
      Line: [
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: `Driver cash handout — reduce customer advance`,
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: advanceAcctId },
            Entity: { Type: 'Customer', EntityRef: { value: customerQbId } },
          },
        },
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: `Driver cash handout — cash out of drawer`,
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: cashAcctId },
          },
        },
      ],
      PrivateNote: `Kuwait POS Advance Handout #${payload.movementId}${payload.memo ? ` — ${payload.memo}` : ''}`,
    };

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(payload.movementId, 'DRY_RUN — advance handout'));
      await AuditLogger.log({
        operation: 'CREATE_ADV_HANDOUT_JE_DRY_RUN',
        entity_type: 'customer_advance',
        entity_id: payload.movementId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: jePayload,
        metadata: { jobId: job.id, durationMs: Date.now() - startTime },
      });
      return { success: true, qbId: 'DRY_RUN' };
    }

    const { accessToken } = await getValidToken(job.organizationId, prisma);
    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const qbRecord = await postJournalEntry(qbApiUrl, connection.realmId, accessToken, jePayload);
    if (!qbRecord?.Id) throw new Error('QB JournalEntry response missing Id');

    await prisma.customerAdvanceMovement.update({
      where: { id: payload.movementId },
      data: { qbSynced: true, qbJournalEntryId: qbRecord.Id, qbSyncedAt: new Date() },
    }).catch((err) =>
      console.warn(`[QB Handler] adv handout post-sync update failed: ${err instanceof Error ? err.message : String(err)}`),
    );

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess('create_advance_handout_journal', payload.movementId, qbRecord.Id, duration));
    await AuditLogger.log({
      operation: 'CREATE_ADV_HANDOUT_JE',
      entity_type: 'customer_advance',
      entity_id: payload.movementId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: jePayload,
      response_payload: qbRecord,
      metadata: { jobId: job.id, durationMs: duration },
    });
    return { success: true, qbId: qbRecord.Id, qbDocNumber: qbRecord.DocNumber };
  } catch (err: any) {
    const classified = classifyError(err);
    logClassifiedError(err, { operation: 'create_advance_handout_journal' });
    await AuditLogger.log({
      operation: 'CREATE_ADV_HANDOUT_JE',
      entity_type: 'customer_advance',
      entity_id: payload.movementId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: err?.message || String(err),
      metadata: { jobId: job.id, errorCategory: classified.category, durationMs: Date.now() - startTime },
    });
    return { success: false, error: err?.message || String(err) };
  }
}
