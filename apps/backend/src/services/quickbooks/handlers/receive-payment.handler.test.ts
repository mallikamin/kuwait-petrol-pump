/**
 * Tests for QuickBooks Receive-Payment handler (S8).
 *
 * Asserts routing for both scenario options:
 *   Option A — Cash tendered: DepositToAccount = bank_account/cash
 *   Option B — Bank transfer / IBFT / cheque / online card: DepositToAccount =
 *              mapped bank (via explicit bankId) or 'default_checking' fallback.
 * Also covers the LinkedTxn→Invoice binding, customer mapping failures, and
 * the company-lock guardrail.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleReceivePaymentCreate, ReceivePaymentPayload } from './receive-payment.handler';
import { QBSyncQueue } from '@prisma/client';
import * as encryption from '../encryption';
import * as safetyGates from '../safety-gates';
import * as auditLogger from '../audit-logger';
import * as companyLock from '../company-lock';
import * as entityMapping from '../entity-mapping.service';

jest.mock('../../../config/database', () => ({
  prisma: {
    qBConnection: { findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../encryption');
jest.mock('../safety-gates');
jest.mock('../audit-logger');
jest.mock('../company-lock');
jest.mock('../entity-mapping.service');
jest.mock('../ensure-customer-mapping', () => ({
  ensureCustomerMapping: jest.fn(async () => undefined),
}));

global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
import { prisma } from '../../../config/database';

const mockConnection = {
  id: 'conn-1',
  organizationId: 'org-1',
  realmId: 'realm-1',
  accessTokenEncrypted: 'enc',
  refreshTokenEncrypted: 'enc-r',
  accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  isActive: true,
};

const mockJob: QBSyncQueue = {
  id: 'job-1',
  connectionId: 'conn-1',
  organizationId: 'org-1',
  jobType: 'create_receive_payment',
  entityType: 'customer_payment',
  entityId: 'receipt-1',
  priority: 5,
  status: 'pending',
  payload: null as any,
  result: null,
  errorMessage: null,
  errorCode: null,
  errorDetail: null,
  httpStatusCode: null,
  retryCount: 0,
  maxRetries: 3,
  nextRetryAt: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  idempotencyKey: null,
  batchId: null,
  checkpointId: null,
  approvalStatus: 'approved',
  approvedBy: null,
  approvedAt: null,
  replayableFromBatch: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as QBSyncQueue;

function basePayload(overrides: Partial<ReceivePaymentPayload> = {}): ReceivePaymentPayload {
  return {
    receiptId: 'receipt-1',
    organizationId: 'org-1',
    customerId: 'customer-xyz',
    qbInvoiceId: 'QB-INV-999',
    paymentDate: '2026-04-19',
    amount: 1500,
    paymentChannel: 'cash',
    ...overrides,
  };
}

describe('Receive-Payment handler (S8)', () => {
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

  it('Option A (cash): deposits to bank_account/cash and links Payment.Line to the invoice', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_org: string, type: string, localId: string) => {
        if (type === 'customer' && localId === 'customer-xyz') return 'QB-CUST-X';
        if (type === 'bank_account' && localId === 'cash') return 'QB-ACC-CASH';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Payment: { Id: 'QB-PAY-1', DocNumber: 'PAY-1' } }),
    } as Response);

    const result = await handleReceivePaymentCreate(mockJob, basePayload());
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('QB-PAY-1');

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(url as string).toContain('/payment?minorversion=65');
    const body = JSON.parse((init as any).body);
    expect(body.CustomerRef.value).toBe('QB-CUST-X');
    expect(body.DepositToAccountRef.value).toBe('QB-ACC-CASH');
    expect(body.TotalAmt).toBe(1500);
    expect(body.Line[0].LinkedTxn[0]).toEqual({ TxnId: 'QB-INV-999', TxnType: 'Invoice' });
  });

  it('Option B (bank transfer with explicit bankId): deposits to mapped bank', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'customer' && id === 'customer-xyz') return 'QB-CUST-X';
        if (type === 'bank_account' && id === 'bank-abl') return 'QB-ACC-ABL';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Payment: { Id: 'QB-PAY-2' } }),
    } as Response);

    const result = await handleReceivePaymentCreate(mockJob, basePayload({
      paymentChannel: 'bank_transfer',
      bankId: 'bank-abl',
      referenceNumber: 'IBFT-112233',
    }));
    expect(result.success).toBe(true);

    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.DepositToAccountRef.value).toBe('QB-ACC-ABL');
    expect(body.PaymentRefNum).toBe('IBFT-112233');
  });

  it('Option B (cheque with no bankId): falls back to default_checking', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'customer' && id === 'customer-xyz') return 'QB-CUST-X';
        if (type === 'bank_account' && id === 'default_checking') return 'QB-ACC-DEFAULT';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Payment: { Id: 'QB-PAY-3' } }),
    } as Response);

    await handleReceivePaymentCreate(mockJob, basePayload({ paymentChannel: 'cheque' }));
    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.DepositToAccountRef.value).toBe('QB-ACC-DEFAULT');
  });

  it('fails fast when customer mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(async () => null);
    await expect(handleReceivePaymentCreate(mockJob, basePayload())).rejects.toThrow(
      /Customer mapping not found for receipt/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast when deposit bank_account mapping is missing', async () => {
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string) => (type === 'customer' ? 'QB-C' : null),
    );
    await expect(handleReceivePaymentCreate(mockJob, basePayload())).rejects.toThrow(
      /Bank account mapping not found for receipt: localId=cash/,
    );
  });

  it('omits Line[] when qbInvoiceId is absent — posts an unapplied ReceivePayment', async () => {
    // Customer has no outstanding AR; credit.service enqueues a payment with
    // no qbInvoiceId. Handler must POST a ReceivePayment without a Line array
    // so QB records it as a negative AR balance (customer advance).
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
      async (_o: string, type: string, id: string) => {
        if (type === 'customer') return 'QB-CUST-X';
        if (type === 'bank_account' && id === 'cash') return 'QB-ACC-CASH';
        return null;
      },
    );
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Payment: { Id: 'QB-PAY-UNAPPLIED' } }),
    } as Response);

    const { qbInvoiceId: _omit, ...noInvoice } = basePayload();
    const result = await handleReceivePaymentCreate(mockJob, noInvoice as any);
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('QB-PAY-UNAPPLIED');

    const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
    expect(body.TotalAmt).toBe(1500);
    expect(body.CustomerRef.value).toBe('QB-CUST-X');
    expect(body.DepositToAccountRef.value).toBe('QB-ACC-CASH');
    expect(body.Line).toBeUndefined();
  });
});
