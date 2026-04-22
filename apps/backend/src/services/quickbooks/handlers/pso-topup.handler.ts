/**
 * QuickBooks PSO Top-Up Handler
 *
 * Posts a local PsoTopup to QB as a JournalEntry:
 *   Dr  Cash in Hand                   (entityType=bank_account, localId='cash')
 *   Cr  Accounts Payable (A/P)         (entityType=account,      localId='accounts-payable')
 *       with Entity.EntityRef = PSO vendor (entityType=vendor, localId='pso-vendor')
 *
 * Rationale: customer hands cash to the pump in exchange for a PSO Card
 * credit. The pump now owes PSO the same amount. Cash goes up; PSO
 * vendor payable goes up. Settlement comes later when PSO remits or the
 * pump deducts it on the next fuel purchase.
 *
 * Required mappings the admin must seed before the first top-up:
 *   bank_account / cash           → QB Cash in Hand account
 *   account      / accounts-payable → QB Accounts Payable (A/P) account
 *   vendor       / pso-vendor     → QB PSO vendor
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

export interface PsoTopupPayload {
  topupId: string;
  organizationId: string;
  amount: number;
  txnDate: string;
  memo: string | null;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

export async function handlePsoTopupJournal(
  job: QBSyncQueue,
  payload: PsoTopupPayload,
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    if (!payload.topupId) throw new Error('Missing required field: topupId');
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

    const { accessToken } = await getValidToken(job.organizationId, prisma);

    // Resolve mappings.
    const cashAccountId = await EntityMappingService.getQbId(job.organizationId, 'bank_account', 'cash');
    if (!cashAccountId) throw new Error('Missing mapping: bank_account/cash (QB Cash in Hand account)');

    const apAccountId = await EntityMappingService.getQbId(job.organizationId, 'account', 'accounts-payable');
    if (!apAccountId) throw new Error('Missing mapping: account/accounts-payable (QB A/P)');

    const psoVendorId = await EntityMappingService.getQbId(job.organizationId, 'vendor', 'pso-vendor');
    if (!psoVendorId) throw new Error('Missing mapping: vendor/pso-vendor (QB PSO supplier)');

    const jePayload = {
      TxnDate: payload.txnDate,
      Line: [
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: payload.memo || 'PSO Card cash top-up — cash received',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: cashAccountId },
          },
        },
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: payload.amount,
          Description: payload.memo || 'PSO Card cash top-up — payable to PSO',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: apAccountId },
            Entity: {
              Type: 'Vendor',
              EntityRef: { value: psoVendorId },
            },
          },
        },
      ],
      PrivateNote: `Kuwait POS PSO Top-Up #${payload.topupId}${payload.memo ? ` — ${payload.memo}` : ''}`,
    };

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(payload.topupId, 'DRY_RUN — no QB write'));
      await AuditLogger.log({
        operation: 'CREATE_PSO_TOPUP_JOURNAL_DRY_RUN',
        entity_type: 'pso_topup',
        entity_id: payload.topupId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: jePayload,
        metadata: { jobId: job.id, syncMode: 'DRY_RUN', durationMs: Date.now() - startTime },
      });
      return { success: true, qbId: 'DRY_RUN' };
    }

    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);
    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/journalentry?minorversion=65`,
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
    const qbRecord = body?.JournalEntry;
    if (!qbRecord?.Id) throw new Error(`QB JournalEntry response missing Id: ${bodyText.slice(0, 300)}`);

    await prisma.psoTopup.update({
      where: { id: payload.topupId },
      data: { qbSynced: true, qbJournalEntryId: qbRecord.Id, qbSyncedAt: new Date() },
    }).catch((err) =>
      console.warn(`[QB Handler] pso-topup post-sync update failed: ${err instanceof Error ? err.message : String(err)}`),
    );

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess('create_pso_topup_journal', payload.topupId, qbRecord.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_PSO_TOPUP_JOURNAL',
      entity_type: 'pso_topup',
      entity_id: payload.topupId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: jePayload,
      response_payload: qbRecord,
      metadata: { jobId: job.id, qbEntity: 'JournalEntry', durationMs: duration },
    });

    return { success: true, qbId: qbRecord.Id, qbDocNumber: qbRecord.DocNumber };
  } catch (err: any) {
    const classified = classifyError(err);
    logClassifiedError(err, { operation: 'create_pso_topup_journal' });
    await AuditLogger.log({
      operation: 'CREATE_PSO_TOPUP_JOURNAL',
      entity_type: 'pso_topup',
      entity_id: payload.topupId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: err?.message || String(err),
      metadata: { jobId: job.id, errorCategory: classified.category, durationMs: Date.now() - startTime },
    });
    return { success: false, error: err?.message || String(err) };
  }
}
