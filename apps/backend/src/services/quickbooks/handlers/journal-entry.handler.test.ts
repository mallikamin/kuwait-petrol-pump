/**
 * Tests for QuickBooks Journal Entry handler (S11 — dip variance).
 *
 * Asserts:
 *   Gain path  — Dr Inventory Asset / Cr <fuel>-gain-income
 *   Loss path  — Dr <fuel>-loss-expense / Cr Inventory Asset
 *   Amount    — |qty| × costPerLitre, rounded to 2dp
 *   Mapping failures fail fast before any QB API call
 *   Invalid payload guardrails (positive qty + positive cost required)
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleJournalEntryCreate, JournalEntryPayload } from './journal-entry.handler';
import { QBSyncQueue } from '@prisma/client';
import * as encryption from '../encryption';
import * as safetyGates from '../safety-gates';
import * as auditLogger from '../audit-logger';
import * as companyLock from '../company-lock';
import * as entityMapping from '../entity-mapping.service';

jest.mock('../../../config/database', () => ({
  prisma: { qBConnection: { findFirst: jest.fn() } },
}));
jest.mock('../encryption');
jest.mock('../safety-gates');
jest.mock('../audit-logger');
jest.mock('../company-lock');
jest.mock('../entity-mapping.service');

global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
import { prisma } from '../../../config/database';

const mockConnection = {
  id: 'conn-1', organizationId: 'org-1', realmId: 'realm-1',
  accessTokenEncrypted: 'x', refreshTokenEncrypted: 'y',
  accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), isActive: true,
};

const mockJob: QBSyncQueue = {
  id: 'job-1', connectionId: 'conn-1', organizationId: 'org-1',
  jobType: 'create_journal_entry', entityType: 'inventory_adjustment', entityId: 'gl-1',
  priority: 5, status: 'pending', payload: null as any, result: null,
  errorMessage: null, errorCode: null, errorDetail: null, httpStatusCode: null,
  retryCount: 0, maxRetries: 3, nextRetryAt: null,
  startedAt: null, completedAt: null, durationMs: null,
  idempotencyKey: null, batchId: null, checkpointId: null,
  approvalStatus: 'approved', approvedBy: null, approvedAt: null,
  replayableFromBatch: null, createdAt: new Date(), updatedAt: new Date(),
} as QBSyncQueue;

function basePayload(overrides: Partial<JournalEntryPayload> = {}): JournalEntryPayload {
  return {
    gainLossId: 'gl-1',
    organizationId: 'org-1',
    fuelCode: 'HSD',
    variant: 'loss',
    quantityLitres: 40,
    costPerLitre: 260,
    monthLabel: '2026-04',
    branchName: 'Main',
    ...overrides,
  };
}

describe('Journal-Entry handler (S11 — dip variance)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safetyGates.checkKillSwitch as jest.MockedFunction<typeof safetyGates.checkKillSwitch>).mockResolvedValue(undefined);
    (safetyGates.checkSyncMode as jest.MockedFunction<typeof safetyGates.checkSyncMode>).mockResolvedValue(undefined as any);
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>).mockResolvedValue(undefined);
    (companyLock.CompanyLock.lockConnectionToOrganization as jest.MockedFunction<typeof companyLock.CompanyLock.lockConnectionToOrganization>).mockResolvedValue(undefined);
    (auditLogger.AuditLogger.log as jest.MockedFunction<typeof auditLogger.AuditLogger.log>).mockResolvedValue(undefined);
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('access');
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
  });

  it('HSD loss: Dr hsd-loss-expense, Cr inventory-asset, Amount = qty*cost', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'account' && id === 'inventory-asset') return 'QB-ACC-INV';
        if (type === 'account' && id === 'hsd-loss-expense') return 'QB-ACC-HSD-LOSS';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ JournalEntry: { Id: 'QB-JE-1', DocNumber: 'DIP-2026-04-HSD-LOSS' } }),
    } as Response);

    const result = await handleJournalEntryCreate(mockJob, basePayload());
    expect(result.success).toBe(true);

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(url as string).toContain('/journalentry');
    const body = JSON.parse((init as any).body);

    expect(body.Line).toHaveLength(2);
    const amount = 40 * 260; // 10400
    expect(body.Line[0].Amount).toBe(amount);
    expect(body.Line[0].JournalEntryLineDetail.PostingType).toBe('Debit');
    expect(body.Line[0].JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-HSD-LOSS');
    expect(body.Line[1].Amount).toBe(amount);
    expect(body.Line[1].JournalEntryLineDetail.PostingType).toBe('Credit');
    expect(body.Line[1].JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-INV');
    expect(body.DocNumber).toBe('DIP-2026-04-HSD-LOSS');
  });

  it('PMG gain: Dr inventory-asset, Cr pmg-gain-income', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'account' && id === 'inventory-asset') return 'QB-ACC-INV';
        if (type === 'account' && id === 'pmg-gain-income') return 'QB-ACC-PMG-GAIN';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ JournalEntry: { Id: 'QB-JE-2' } }),
    } as Response);

    await handleJournalEntryCreate(mockJob, basePayload({
      fuelCode: 'PMG',
      variant: 'gain',
      quantityLitres: 25,
      costPerLitre: 290.5,
    }));

    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.Line[0].JournalEntryLineDetail.PostingType).toBe('Debit');
    expect(body.Line[0].JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-INV');
    expect(body.Line[1].JournalEntryLineDetail.PostingType).toBe('Credit');
    expect(body.Line[1].JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-PMG-GAIN');
    // rounding: 25 * 290.5 = 7262.5 (exact 2dp)
    expect(body.Line[0].Amount).toBeCloseTo(7262.5, 2);
  });

  it('rounds amount to 2dp so QB never rejects on debit≠credit', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'account') return `QB-ACC-${id}`;
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ JournalEntry: { Id: 'QB-JE-3' } }),
    } as Response);
    // 3.333L × 99.999 = 333.296667 → expect 333.3
    await handleJournalEntryCreate(mockJob, basePayload({ quantityLitres: 3.333, costPerLitre: 99.999 }));
    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.Line[0].Amount).toBe(body.Line[1].Amount);
    expect(body.Line[0].Amount).toBe(333.3);
  });

  it('fails fast when inventory-asset account mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(async () => null);
    await expect(handleJournalEntryCreate(mockJob, basePayload())).rejects.toThrow(
      /Account mapping not found: localId=inventory-asset/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast when fuel-specific gain/loss account mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'account' && id === 'inventory-asset') return 'QB-ACC-INV';
        return null;
      },
    );
    await expect(handleJournalEntryCreate(mockJob, basePayload())).rejects.toThrow(
      /Account mapping not found: localId=hsd-loss-expense/,
    );
  });

  it('rejects non-positive quantity (sign lives in variant, not qty)', async () => {
    await expect(handleJournalEntryCreate(mockJob, basePayload({ quantityLitres: 0 }))).rejects.toThrow(
      /Invalid quantityLitres/,
    );
    await expect(handleJournalEntryCreate(mockJob, basePayload({ quantityLitres: -5 }))).rejects.toThrow(
      /Invalid quantityLitres/,
    );
  });

  it('rejects non-positive costPerLitre (0-amount JE would silently noop in QB)', async () => {
    await expect(handleJournalEntryCreate(mockJob, basePayload({ costPerLitre: 0 }))).rejects.toThrow(
      /Invalid costPerLitre/,
    );
  });
});
