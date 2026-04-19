/**
 * QuickBooks Journal Entry Handler (S11 — Dip variance gain / loss)
 *
 * Workbook S11 posts the monthly dip-variance reconciliation as paired
 * journal entries:
 *
 *   GAIN  (actual stock > expected):
 *     Dr  Inventory Asset  (per-fuel sub-account or single inventory account)
 *     Cr  <HSD|PMG> normal volume gain   (Other Income)
 *
 *   LOSS  (actual stock < expected):
 *     Dr  <HSD|PMG> volume normal loss   (Other Expense / COGS — QB has these in COGS)
 *     Cr  Inventory Asset
 *
 * Amount = |variance_qty_litres| × cost_per_litre_at_month_close.
 *
 * Account mapping `localId` conventions (documented here + qb-shared.ts):
 *   entityType='account'  localId='inventory-asset'        → QB "Inventory Asset"  (shared by HSD/PMG)
 *   entityType='account'  localId='hsd-gain-income'        → QB "HSD normal volume gain"
 *   entityType='account'  localId='pmg-gain-income'        → QB "PMG normal volume gain"
 *   entityType='account'  localId='hsd-loss-expense'       → QB "HSD volume normal loss"
 *   entityType='account'  localId='pmg-loss-expense'       → QB "PMG volume normal loss"
 *
 * This handler deliberately uses AccountBasedJournalEntryLineDetail rather
 * than item-based lines. QB JournalEntry doesn't auto-move perpetual
 * inventory quantity; the workbook's "Inventory Asset" entry is a monetary
 * adjustment, which is exactly what AccountBased lines do. Item-level
 * quantity is already correct in the POS — this JE just books the monetary
 * impact on the GL so QB matches.
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

export interface JournalEntryPayload {
  /** MonthlyInventoryGainLoss.id — the source-of-truth row this JE mirrors. */
  gainLossId: string;
  organizationId: string;
  fuelCode: 'HSD' | 'PMG';
  /** 'gain' when variance is positive (stock up), 'loss' when negative. */
  variant: 'gain' | 'loss';
  /** Positive litres; the sign was already applied to pick `variant`. */
  quantityLitres: number;
  /** Last purchase cost / weighted average per-litre at month close. */
  costPerLitre: number;
  /** 'YYYY-MM' — becomes the JE memo so operators can find it by month. */
  monthLabel: string;
  /** Optional branch label for the PrivateNote. */
  branchName?: string;
}

export interface JournalEntryResult {
  success: boolean;
  qbId?: string;
  qbDocNumber?: string;
  error?: string;
}

export async function handleJournalEntryCreate(
  job: QBSyncQueue,
  payload: JournalEntryPayload
): Promise<JournalEntryResult> {
  const startTime = Date.now();
  const operation = 'CREATE_JOURNAL_ENTRY';

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
    const jePayload = await buildJournalEntryPayload(job.organizationId, payload);

    if (syncMode === 'DRY_RUN') {
      console.log(OpLog.dryRunDecision(
        payload.gainLossId,
        `Sync mode is DRY_RUN - would POST JournalEntry (${payload.variant} ${payload.fuelCode})`
      ));

      await AuditLogger.log({
        operation: `${operation}_DRY_RUN`,
        entity_type: 'inventory_adjustment',
        entity_id: payload.gainLossId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
        request_payload: jePayload,
        metadata: {
          jobId: job.id,
          syncMode: 'DRY_RUN',
          durationMs: Date.now() - startTime,
          fuelCode: payload.fuelCode,
          variant: payload.variant,
          monthLabel: payload.monthLabel,
          note: 'Dry-run mode: No QB API call made',
        },
      });

      return { success: true, qbId: 'DRY_RUN', qbDocNumber: 'DRY_RUN' };
    }

    console.log(
      `[QB Handler][FULL_SYNC] Creating JournalEntry for gain/loss ${payload.gainLossId} ` +
      `(${payload.fuelCode} ${payload.variant} ${payload.quantityLitres}L @ ${payload.costPerLitre})`
    );

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
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QB API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData = (await response.json()) as any;
    const je = responseData.JournalEntry;
    const duration = Date.now() - startTime;

    console.log(OpLog.qbWriteSuccess(operation, payload.gainLossId, je.Id, duration));

    await AuditLogger.log({
      operation,
      entity_type: 'inventory_adjustment',
      entity_id: payload.gainLossId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      request_payload: jePayload,
      response_payload: je,
      metadata: {
        jobId: job.id,
        syncMode: 'FULL_SYNC',
        qbId: je.Id,
        qbDocNumber: je.DocNumber,
        durationMs: duration,
        fuelCode: payload.fuelCode,
        variant: payload.variant,
        monthLabel: payload.monthLabel,
      },
    });

    return { success: true, qbId: je.Id, qbDocNumber: je.DocNumber };
  } catch (error) {
    const duration = Date.now() - startTime;
    const classified = classifyError(error instanceof Error ? error : new Error(String(error)));
    console.error(OpLog.qbWriteFail(operation, payload.gainLossId, classified.category));
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
      operation,
      entity_type: 'inventory_adjustment',
      entity_id: payload.gainLossId,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: error instanceof Error ? error.message : String(error),
      metadata: {
        jobId: job.id,
        syncMode,
        durationMs: duration,
        fuelCode: payload.fuelCode,
        variant: payload.variant,
        errorCategory: classified.category,
        errorSeverity: classified.severity,
        isRetryable: classified.isRetryable,
        recommendedAction: classified.action,
      },
    });

    throw error;
  }
}

function validatePayload(p: JournalEntryPayload): void {
  if (!p.gainLossId) throw new Error('Missing required field: gainLossId');
  if (!p.organizationId) throw new Error('Missing required field: organizationId');
  if (p.fuelCode !== 'HSD' && p.fuelCode !== 'PMG') {
    throw new Error(`Invalid fuelCode: ${p.fuelCode}. Must be HSD or PMG.`);
  }
  if (p.variant !== 'gain' && p.variant !== 'loss') {
    throw new Error(`Invalid variant: ${p.variant}. Must be gain or loss.`);
  }
  if (!(p.quantityLitres > 0)) {
    throw new Error(`Invalid quantityLitres: ${p.quantityLitres}. Must be positive (sign lives in variant).`);
  }
  if (!(p.costPerLitre > 0)) {
    throw new Error(
      `Invalid costPerLitre: ${p.costPerLitre}. Must be > 0 — without a cost basis the JE would post a 0 amount. ` +
      `The enqueuer must supply the month-close avg cost from FuelInventory.avgCostPerLiter.`
    );
  }
  if (!p.monthLabel) throw new Error('Missing required field: monthLabel');
}

async function resolveAccountRef(organizationId: string, localId: string): Promise<string> {
  const qbId = await EntityMappingService.getQbId(organizationId, 'account', localId);
  if (!qbId) {
    throw new Error(
      `Account mapping not found: localId=${localId}. ` +
      `Create mapping (entityType: account, localId: ${localId}) before syncing dip-variance journal entries.`
    );
  }
  return qbId;
}

async function buildJournalEntryPayload(
  organizationId: string,
  payload: JournalEntryPayload,
): Promise<any> {
  const amount = roundMoney(payload.quantityLitres * payload.costPerLitre);

  // Resolve both legs. All four loss/gain accounts are fuel-specific
  // (workbook names them "HSD normal volume gain" etc.) so the localId
  // pattern is `<fuel-lower>-(gain-income|loss-expense)`.
  const inventoryAccountQbId = await resolveAccountRef(organizationId, 'inventory-asset');
  const counterLocalId = payload.variant === 'gain'
    ? `${payload.fuelCode.toLowerCase()}-gain-income`
    : `${payload.fuelCode.toLowerCase()}-loss-expense`;
  const counterAccountQbId = await resolveAccountRef(organizationId, counterLocalId);

  const debitAccount = payload.variant === 'gain' ? inventoryAccountQbId : counterAccountQbId;
  const creditAccount = payload.variant === 'gain' ? counterAccountQbId : inventoryAccountQbId;
  const debitDescription = payload.variant === 'gain'
    ? `${payload.fuelCode} dip-variance gain — Inventory Asset adjustment ${payload.monthLabel}`
    : `${payload.fuelCode} dip-variance loss — P&L impact ${payload.monthLabel}`;
  const creditDescription = payload.variant === 'gain'
    ? `${payload.fuelCode} dip-variance gain — Other Income ${payload.monthLabel}`
    : `${payload.fuelCode} dip-variance loss — Inventory Asset reduction ${payload.monthLabel}`;

  return {
    TxnDate: `${payload.monthLabel}-01`, // JE dated to month-start; month label doubles as memo
    PrivateNote: `Kuwait POS dip variance ${payload.monthLabel} — ${payload.branchName || 'branch'} — ${payload.fuelCode} ${payload.variant}`,
    DocNumber: `DIP-${payload.monthLabel}-${payload.fuelCode}-${payload.variant.toUpperCase()}`,
    Line: [
      {
        Amount: amount,
        DetailType: 'JournalEntryLineDetail',
        Description: debitDescription,
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: { value: debitAccount },
        },
      },
      {
        Amount: amount,
        DetailType: 'JournalEntryLineDetail',
        Description: creditDescription,
        JournalEntryLineDetail: {
          PostingType: 'Credit',
          AccountRef: { value: creditAccount },
        },
      },
    ],
  };
}

function roundMoney(v: number): number {
  // QB tolerates 2-dp currency; round to avoid floating-point drift causing
  // "Journal entry total does not equal 0" validation failures.
  return Math.round(v * 100) / 100;
}
