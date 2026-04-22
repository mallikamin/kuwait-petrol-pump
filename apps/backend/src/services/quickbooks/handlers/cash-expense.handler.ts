/**
 * QuickBooks Cash Expense Handler
 *
 * Posts a local ExpenseEntry to QB as a cash Purchase with
 * AccountBasedExpenseLineDetail. Effect in QB books:
 *     Dr <Expense Account>    (AccountBasedExpenseLineDetail.AccountRef)
 *     Cr Cash in Hand         (Purchase.AccountRef = mapped cash account)
 *
 * Account resolution:
 *   - The local ExpenseAccount row carries `qb_account_name` (exact QB
 *     account name, e.g. "Admin Expenses:Cleaning Expense"). We look up
 *     the QB Account by Name via the QB query API at post time.
 *   - The cash-in-hand account is the existing mapping
 *     entityType='bank_account', localId='cash' (same one used by the
 *     S8 receive-payment handler for cash deposits).
 *
 * This handler is intentionally lightweight — no vendor, no inventory
 * item, no line-items. It is a pure cash-out expense.
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

export interface CashExpensePayload {
  expenseId: string;
  organizationId: string;
  qbAccountName: string | null; // e.g. "Admin Expenses:Cleaning Expense"
  accountLabel: string;         // POS-side label (used as PrivateNote fallback)
  amount: number;
  txnDate: string;              // YYYY-MM-DD
  memo: string | null;
}

export interface JobResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

export async function handleCashExpenseCreate(
  job: QBSyncQueue,
  payload: CashExpensePayload,
): Promise<JobResult> {
  const startTime = Date.now();

  try {
    if (!payload.expenseId) throw new Error('Missing required field: expenseId');
    if (!payload.qbAccountName) {
      throw new Error(
        `Expense account "${payload.accountLabel}" has no qbAccountName mapping. ` +
        `Set the exact QB account name on the ExpenseAccount row before syncing.`
      );
    }
    if (!payload.amount || payload.amount <= 0) throw new Error('Invalid amount: must be > 0');

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
    const qbApiUrl = getQuickBooksApiUrl(connection.realmId);

    // 1. Resolve expense account — lookup by name via QB query API.
    const expenseAccountId = await lookupQbAccountByName(
      qbApiUrl,
      connection.realmId,
      accessToken,
      payload.qbAccountName,
    );
    if (!expenseAccountId) {
      throw new Error(
        `QB account not found by name: "${payload.qbAccountName}". ` +
        `Create it in QB or correct the qb_account_name on the local ExpenseAccount.`
      );
    }

    // 2. Resolve cash-in-hand deposit account — use the existing 'cash' mapping.
    const cashAccountQbId = await EntityMappingService.getQbId(
      job.organizationId,
      'bank_account',
      'cash',
    );
    if (!cashAccountQbId) {
      throw new Error(
        `Bank account mapping not found for localId='cash'. ` +
        `Create mapping (entityType: bank_account, localId: cash) pointing at the QB cash-in-hand account.`
      );
    }

    const purchasePayload = {
      AccountRef: { value: cashAccountQbId },
      PaymentType: 'Cash',
      TxnDate: payload.txnDate,
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: payload.amount,
          Description: payload.memo || payload.accountLabel,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: expenseAccountId },
          },
        },
      ],
      PrivateNote: `Kuwait POS Expense #${payload.expenseId}${payload.memo ? ` — ${payload.memo}` : ''}`,
    };

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(payload.expenseId, 'DRY_RUN — no QB write'));
      await AuditLogger.log({
        operation: 'CREATE_CASH_EXPENSE_DRY_RUN',
        entity_type: 'expense',
        entity_id: payload.expenseId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: purchasePayload,
        metadata: { jobId: job.id, syncMode: 'DRY_RUN', durationMs: Date.now() - startTime },
      });
      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN' };
    }

    console.log(`[QB Handler][FULL_SYNC] Creating Purchase (cash expense) for expense ${payload.expenseId}`);

    const response = await fetch(
      `${qbApiUrl}/v3/company/${connection.realmId}/purchase?minorversion=65`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(purchasePayload),
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`QB API ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const body = JSON.parse(bodyText);
    const qbRecord = body?.Purchase;
    if (!qbRecord?.Id) {
      throw new Error(`QB Purchase response missing Id: ${bodyText.slice(0, 300)}`);
    }

    await prisma.expenseEntry.update({
      where: { id: payload.expenseId },
      data: {
        qbSynced: true,
        qbPurchaseId: qbRecord.Id,
        qbSyncedAt: new Date(),
      },
    }).catch((err) => {
      // Non-fatal: QB document is already posted; we'll recover on next retry.
      console.warn(
        `[QB Handler] post-sync expense update failed for ${payload.expenseId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    const duration = Date.now() - startTime;
    console.log(OpLog.qbWriteSuccess('create_cash_expense', payload.expenseId, qbRecord.Id, duration));

    await AuditLogger.log({
      operation: 'CREATE_CASH_EXPENSE',
      entity_type: 'expense',
      entity_id: payload.expenseId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: purchasePayload,
      response_payload: qbRecord,
      metadata: { jobId: job.id, qbEntity: 'Purchase', durationMs: duration },
    });

    return { success: true, qbId: qbRecord.Id, qbDocNumber: qbRecord.DocNumber };
  } catch (err: any) {
    const classified = classifyError(err);
    logClassifiedError(err, { operation: 'create_cash_expense' });
    await AuditLogger.log({
      operation: 'CREATE_CASH_EXPENSE',
      entity_type: 'expense',
      entity_id: payload.expenseId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: err?.message || String(err),
      metadata: {
        jobId: job.id,
        errorCategory: classified.category,
        durationMs: Date.now() - startTime,
      },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

async function lookupQbAccountByName(
  qbApiUrl: string,
  realmId: string,
  accessToken: string,
  accountName: string,
): Promise<string | null> {
  const escaped = accountName.replace(/'/g, "\\'");
  const query = `SELECT Id, Name FROM Account WHERE Name = '${escaped}'`;
  const resp = await fetch(
    `${qbApiUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
  );
  if (!resp.ok) {
    throw new Error(`QB account query failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const body: any = await resp.json();
  const hit = body?.QueryResponse?.Account?.[0];
  return hit?.Id || null;
}
