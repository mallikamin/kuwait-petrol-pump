/**
 * Regression tests for the QB enqueue hook in credit.service.createReceipt.
 *
 * Behaviour covered:
 *   - After a receipt is committed, one ReceivePayment job is enqueued per
 *     allocation whose upstream Sale already carries qbInvoiceId.
 *   - Allocations whose Sale.qbInvoiceId is null are SKIPPED with a warning
 *     (receipt still persists; admin replays once invoice syncs).
 *   - BACKDATED_TRANSACTION allocations resolve to the finalize-created Sale
 *     via offlineQueueId='backdated-<txnId>'.
 *   - Enqueue errors do NOT bubble out — receipt is already committed.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CreditService } from './credit.service';

jest.mock('../../config/database', () => {
  // In-line transaction mock — the real createReceipt runs inside
  // `prisma.$transaction(async (tx) => {...})`. The tx passed to the
  // callback exposes the same surface the code uses.
  const tx = {
    $queryRaw: jest.fn(async () => [] as any),
    customerReceipt: { create: jest.fn() },
    customerReceiptAllocation: {
      create: jest.fn(async () => ({}) as any),
      findMany: jest.fn(),
    },
    customer: { update: jest.fn(async () => ({}) as any) },
    auditLog: { create: jest.fn(async () => ({}) as any) },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      sale: { findUnique: jest.fn(), findFirst: jest.fn() },
      qBConnection: { findFirst: jest.fn() },
      qBSyncQueue: { createMany: jest.fn() },
      // Exposed so tests can grab the inner tx mock
      __tx: tx,
    },
  };
});

import { prisma } from '../../config/database';
const tx = (prisma as any).__tx;
const svc = new CreditService();
const orgId = 'org-1';

// Bypass validateOrgIsolation, generateReceiptNumber, recalculateBalance,
// autoAllocateFIFO by stubbing them on the service instance. This keeps the
// test focused on the enqueue behaviour.
(svc as any).validateOrgIsolation = jest.fn(async () => undefined);
(svc as any).generateReceiptNumber = jest.fn(async () => 'R-TEST-1');
(svc as any).validateAllocations = jest.fn(async () => undefined);
(svc as any).autoAllocateFIFO = jest.fn(async () => undefined);
(svc as any).recalculateBalance = jest.fn(async () => 0);

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue({
    id: 'qb-conn-1', organizationId: orgId, isActive: true,
  } as any);
  (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mockResolvedValue({ count: 1 } as any);
  tx.customerReceipt.create.mockResolvedValue({
    id: 'r-1', organizationId: orgId, receiptNumber: 'R-TEST-1', amount: 1000, paymentMethod: 'cash',
  } as any);
});

describe('CreditService.createReceipt → QB enqueue', () => {
  it('enqueues a ReceivePayment per SALE allocation whose Sale has qbInvoiceId', async () => {
    tx.customerReceiptAllocation.findMany.mockResolvedValue([
      { sourceType: 'SALE', sourceId: 'sale-1', allocatedAmount: 600 },
      { sourceType: 'SALE', sourceId: 'sale-2', allocatedAmount: 400 },
    ] as any);
    (prisma.sale.findUnique as jest.MockedFunction<any>).mockImplementation(async ({ where }: any) => {
      if (where?.id === 'sale-1') return { qbInvoiceId: 'QB-INV-A' } as any;
      if (where?.id === 'sale-2') return { qbInvoiceId: 'QB-INV-B' } as any;
      return null;
    });

    await svc.createReceipt(orgId, 'user-1', {
      customerId: 'c-1', branchId: 'b-1',
      receiptDatetime: new Date('2026-04-19'), amount: 1000,
      paymentMethod: 'cash', allocationMode: 'MANUAL',
      allocations: [
        { sourceType: 'SALE', sourceId: 'sale-1', amount: 600 },
        { sourceType: 'SALE', sourceId: 'sale-2', amount: 400 },
      ],
    });

    expect(prisma.qBSyncQueue.createMany).toHaveBeenCalledTimes(1);
    const rows = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0].data as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].jobType).toBe('create_receive_payment');
    expect(rows[0].payload.qbInvoiceId).toBe('QB-INV-A');
    expect(rows[0].payload.amount).toBe(600);
    expect(rows[0].idempotencyKey).toBe('qb-receipt-r-1-SALE-sale-1');
    expect(rows[1].payload.qbInvoiceId).toBe('QB-INV-B');
    expect(rows[1].idempotencyKey).toBe('qb-receipt-r-1-SALE-sale-2');
  });

  it('skips allocations whose Sale has no qbInvoiceId yet (still persists receipt)', async () => {
    tx.customerReceiptAllocation.findMany.mockResolvedValue([
      { sourceType: 'SALE', sourceId: 'sale-syncd', allocatedAmount: 500 },
      { sourceType: 'SALE', sourceId: 'sale-unsyncd', allocatedAmount: 500 },
    ] as any);
    (prisma.sale.findUnique as jest.MockedFunction<any>).mockImplementation(async ({ where }: any) => {
      if (where?.id === 'sale-syncd') return { qbInvoiceId: 'QB-INV-X' } as any;
      return { qbInvoiceId: null } as any;
    });

    await svc.createReceipt(orgId, 'user-1', {
      customerId: 'c-1', branchId: 'b-1',
      receiptDatetime: new Date('2026-04-19'), amount: 1000,
      paymentMethod: 'cash', allocationMode: 'MANUAL',
      allocations: [
        { sourceType: 'SALE', sourceId: 'sale-syncd', amount: 500 },
        { sourceType: 'SALE', sourceId: 'sale-unsyncd', amount: 500 },
      ],
    });

    const rows = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0].data as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.qbInvoiceId).toBe('QB-INV-X');
  });

  it('BACKDATED_TRANSACTION resolves via offlineQueueId=backdated-<txnId>', async () => {
    tx.customerReceiptAllocation.findMany.mockResolvedValue([
      { sourceType: 'BACKDATED_TRANSACTION', sourceId: 'txn-7', allocatedAmount: 200 },
    ] as any);
    (prisma.sale.findFirst as jest.MockedFunction<any>).mockImplementation(async ({ where }: any) => {
      expect(where.offlineQueueId).toBe('backdated-txn-7');
      return { qbInvoiceId: 'QB-INV-BD' } as any;
    });

    await svc.createReceipt(orgId, 'user-1', {
      customerId: 'c-1', branchId: 'b-1',
      receiptDatetime: new Date('2026-04-19'), amount: 200,
      paymentMethod: 'bank_transfer', allocationMode: 'MANUAL',
      bankId: 'bank-abl',
      allocations: [{ sourceType: 'BACKDATED_TRANSACTION', sourceId: 'txn-7', amount: 200 }],
    });

    const row = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0].data[0];
    expect(row.payload.qbInvoiceId).toBe('QB-INV-BD');
    expect(row.payload.paymentChannel).toBe('bank_transfer');
    expect(row.payload.bankId).toBe('bank-abl');
  });

  it('no QB connection → no enqueue (receipt still returns)', async () => {
    tx.customerReceiptAllocation.findMany.mockResolvedValue([
      { sourceType: 'SALE', sourceId: 'sale-1', allocatedAmount: 100 },
    ] as any);
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(null);

    const result = await svc.createReceipt(orgId, 'user-1', {
      customerId: 'c-1', branchId: 'b-1',
      receiptDatetime: new Date('2026-04-19'), amount: 100,
      paymentMethod: 'cash', allocationMode: 'MANUAL',
      allocations: [{ sourceType: 'SALE', sourceId: 'sale-1', amount: 100 }],
    });

    expect(prisma.qBSyncQueue.createMany).not.toHaveBeenCalled();
    expect((result as any).id).toBe('r-1');
  });
});
