/**
 * Tests for QuickBooks PSO-Card Settlement handler (S8C).
 *
 * Asserts:
 *   - JE body: Dr A/R Entity=pso-card-rec, Cr A/R Entity=original customer
 *   - $0 Payment applied per allocation with LinkedTxn binding Invoice ↔ JE
 *   - Allocation sum must equal totalAmount (validator)
 *   - Missing pso-card-receivable mapping fails fast
 *   - Partial Payment failure does NOT abort the overall sync (audit logged)
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handlePsoCardSettlement, PsoCardSettlementPayload } from './pso-card-settlement.handler';
import { QBSyncQueue } from '@prisma/client';
import * as encryption from '../encryption';
import * as safetyGates from '../safety-gates';
import * as auditLogger from '../audit-logger';
import * as companyLock from '../company-lock';
import * as entityMapping from '../entity-mapping.service';
import * as ensureCustomer from '../ensure-customer-mapping';

jest.mock('../../../config/database', () => ({
  prisma: { qBConnection: { findFirst: jest.fn() } },
}));
jest.mock('../encryption');
jest.mock('../safety-gates');
jest.mock('../audit-logger');
jest.mock('../company-lock');
jest.mock('../entity-mapping.service');
jest.mock('../ensure-customer-mapping');
jest.mock('../token-refresh', () => ({
  getValidAccessToken: jest.fn(async () => ({ accessToken: 'fake-access-token' })),
}));

global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
import { prisma } from '../../../config/database';

const mockConnection = {
  id: 'conn-1', organizationId: 'org-1', realmId: 'realm-1',
  accessTokenEncrypted: 'x', refreshTokenEncrypted: 'y',
  accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), isActive: true,
};

const mockJob: QBSyncQueue = {
  id: 'job-1', connectionId: 'conn-1', organizationId: 'org-1',
  jobType: 'create_pso_card_ar_transfer_journal',
  entityType: 'customer_receipt',
  entityId: 'receipt-1',
  priority: 5, status: 'pending', payload: null as any, result: null,
  errorMessage: null, errorCode: null, errorDetail: null, httpStatusCode: null,
  retryCount: 0, maxRetries: 3, nextRetryAt: null,
  startedAt: null, completedAt: null, durationMs: null,
  idempotencyKey: null, batchId: null, checkpointId: null,
  approvalStatus: 'approved', approvedBy: null, approvedAt: null,
  replayableFromBatch: null, createdAt: new Date(), updatedAt: new Date(),
} as QBSyncQueue;

function basePayload(overrides: Partial<PsoCardSettlementPayload> = {}): PsoCardSettlementPayload {
  return {
    receiptId: 'receipt-1',
    organizationId: 'org-1',
    customerId: 'cust-bpo',
    txnDate: '2026-04-23',
    totalAmount: 1500,
    allocations: [{ qbInvoiceId: 'INV-100', amount: 1500 }],
    referenceNumber: 'PSO-REF-XYZ',
    ...overrides,
  };
}

function mockFetchResponses(...responses: Array<{ status: number; body: any }>) {
  const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.status === 200,
      status: r.status,
      statusText: r.status === 200 ? 'OK' : 'Error',
      text: async () => JSON.stringify(r.body),
    } as Response);
  }
}

function mappingFactory(overrides: Record<string, string | null> = {}) {
  const defaults: Record<string, string | null> = {
    'customer/cust-bpo': 'QB-CUST-BPO',
    'customer/pso-card-receivable': 'QB-CUST-PSO',
    'account/accounts-receivable': 'QB-ACC-AR',
  };
  const merged = { ...defaults, ...overrides };
  return async (_org: string, type: string, localId: string) => {
    return merged[`${type}/${localId}`] ?? null;
  };
}

describe('PSO-Card Settlement handler (S8C)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (safetyGates.checkKillSwitch as jest.MockedFunction<typeof safetyGates.checkKillSwitch>).mockResolvedValue(undefined);
    (safetyGates.checkSyncMode as jest.MockedFunction<typeof safetyGates.checkSyncMode>).mockResolvedValue('FULL_SYNC' as any);
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>).mockResolvedValue(undefined);
    (companyLock.CompanyLock.lockConnectionToOrganization as jest.MockedFunction<typeof companyLock.CompanyLock.lockConnectionToOrganization>).mockResolvedValue(undefined);
    (auditLogger.AuditLogger.log as jest.MockedFunction<typeof auditLogger.AuditLogger.log>).mockResolvedValue(undefined);
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('access');
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
    (ensureCustomer.ensureCustomerMapping as jest.MockedFunction<any>).mockResolvedValue(undefined);
  });

  it('posts JE with Dr A/R/PSO and Cr A/R/orig-customer on the same A/R account', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(mappingFactory());
    mockFetchResponses(
      { status: 200, body: { JournalEntry: { Id: 'JE-500', DocNumber: 'PSO-receipt' } } },
      { status: 200, body: { Payment: { Id: 'PAY-600' } } },
    );

    const result = await handlePsoCardSettlement(mockJob, basePayload());
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('JE-500');

    const [jeCall] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls;
    expect(jeCall[0] as string).toContain('/journalentry?minorversion=65');
    const jeBody = JSON.parse((jeCall[1] as any).body);

    expect(jeBody.TxnDate).toBe('2026-04-23');
    expect(jeBody.Line).toHaveLength(2);

    const dr = jeBody.Line.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Debit');
    const cr = jeBody.Line.find((l: any) => l.JournalEntryLineDetail.PostingType === 'Credit');
    expect(dr.Amount).toBe(1500);
    expect(dr.JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-AR');
    expect(dr.JournalEntryLineDetail.Entity).toEqual({ Type: 'Customer', EntityRef: { value: 'QB-CUST-PSO' } });

    expect(cr.Amount).toBe(1500);
    expect(cr.JournalEntryLineDetail.AccountRef.value).toBe('QB-ACC-AR');
    expect(cr.JournalEntryLineDetail.Entity).toEqual({ Type: 'Customer', EntityRef: { value: 'QB-CUST-BPO' } });
  });

  it('applies a $0 Payment per allocation linking Invoice ↔ JE credit', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(mappingFactory());
    mockFetchResponses(
      { status: 200, body: { JournalEntry: { Id: 'JE-700' } } },
      { status: 200, body: { Payment: { Id: 'PAY-A' } } },
      { status: 200, body: { Payment: { Id: 'PAY-B' } } },
    );

    await handlePsoCardSettlement(
      mockJob,
      basePayload({
        totalAmount: 2500,
        allocations: [
          { qbInvoiceId: 'INV-100', amount: 1500 },
          { qbInvoiceId: 'INV-101', amount: 1000 },
        ],
      }),
    );

    // 1 JE + 2 Payments = 3 fetch calls
    expect((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls).toHaveLength(3);

    // Payment[0] for INV-100
    const payCall1 = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[1];
    expect(payCall1[0] as string).toContain('/payment?minorversion=65');
    const payBody1 = JSON.parse((payCall1[1] as any).body);
    expect(payBody1.TotalAmt).toBe(0);
    expect(payBody1.CustomerRef.value).toBe('QB-CUST-BPO');
    expect(payBody1.Line[0].Amount).toBe(1500);
    expect(payBody1.Line[0].LinkedTxn[0]).toEqual({ TxnId: 'INV-100', TxnType: 'Invoice' });
    // QB rejects negative Line.Amount: both lines must be positive; TotalAmt=0
    // tells QB the JE credit covers the Invoice pay line.
    expect(payBody1.Line[1].Amount).toBe(1500);
    expect(payBody1.Line[1].LinkedTxn[0]).toEqual({ TxnId: 'JE-700', TxnType: 'JournalEntry' });

    // Payment[1] for INV-101
    const payCall2 = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[2];
    const payBody2 = JSON.parse((payCall2[1] as any).body);
    expect(payBody2.Line[0].LinkedTxn[0].TxnId).toBe('INV-101');
    expect(payBody2.Line[0].Amount).toBe(1000);
  });

  it('does NOT abort overall sync if Payment application fails — JE still succeeds', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(mappingFactory());
    mockFetchResponses(
      { status: 200, body: { JournalEntry: { Id: 'JE-800' } } },
      { status: 400, body: { Fault: { Error: [{ Message: 'Linked txn invalid' }] } } },
    );

    const result = await handlePsoCardSettlement(mockJob, basePayload());
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('JE-800');
  });

  it('fails fast when pso-card-receivable customer mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      mappingFactory({ 'customer/pso-card-receivable': null }),
    );
    await expect(handlePsoCardSettlement(mockJob, basePayload())).rejects.toThrow(
      /customer\/pso-card-receivable/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('validates allocation sum matches totalAmount', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(mappingFactory());
    await expect(
      handlePsoCardSettlement(
        mockJob,
        basePayload({
          totalAmount: 2500,
          allocations: [{ qbInvoiceId: 'INV-100', amount: 1500 }],
        }),
      ),
    ).rejects.toThrow(/Allocation sum 1500.00 does not match totalAmount 2500.00/);
  });

  it('rejects empty allocations', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(mappingFactory());
    await expect(
      handlePsoCardSettlement(mockJob, basePayload({ allocations: [] })),
    ).rejects.toThrow(/at least one allocation/);
  });
});
