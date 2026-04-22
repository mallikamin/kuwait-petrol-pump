/**
 * Unit tests for CashLedgerService.
 *
 * Covered:
 *   - post() inserts an entry with normalised businessDate
 *   - post() is idempotent on (source, sourceId, direction) — P2002 swallowed
 *   - post() throws on invalid amount (<=0)
 *   - tryPost() swallows arbitrary errors so hooks don't crash callers
 *   - getDaySummary aggregates by direction+source and reports net
 *   - reverse() marks entry as reversed; double-reversal throws
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CashLedgerService } from './cash-ledger.service';

jest.mock('../../config/database', () => {
  const entries: any[] = [];
  return {
    prisma: {
      __entries: entries,
      cashLedgerEntry: {
        create: jest.fn(async ({ data }: any) => {
          const composite = `${data.source}::${data.sourceId || 'null'}::${data.direction}`;
          if (entries.some((e) => e._key === composite)) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          const row = {
            id: `entry-${entries.length + 1}`,
            ...data,
            organizationId: data.organization?.connect?.id,
            branchId: data.branch?.connect?.id,
            shiftInstanceId: data.shiftInstance?.connect?.id || null,
            createdBy: data.createdByUser?.connect?.id || null,
            reversedAt: null,
            reversedBy: null,
            createdAt: new Date('2026-04-22T10:00:00Z'),
            amount: data.amount,
            _key: composite,
          };
          entries.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return entries.filter((e) => {
            if (where.organizationId && e.organizationId !== where.organizationId) return false;
            if (where.branchId && e.branchId !== where.branchId) return false;
            if (where.businessDate && e.businessDate.getTime() !== where.businessDate.getTime()) return false;
            if (where.reversedAt === null && e.reversedAt) return false;
            return true;
          });
        }),
        findUnique: jest.fn(async ({ where }: any) => entries.find((e) => e.id === where.id) || null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = entries.find((e) => e.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        }),
      },
    },
  };
});

import { prisma } from '../../config/database';
const entries = (prisma as any).__entries as any[];

beforeEach(() => {
  entries.length = 0;
  jest.clearAllMocks();
});

const baseInput = {
  organizationId: 'org-1',
  branchId: 'branch-1',
  businessDate: new Date('2026-04-22T15:30:00Z'),
  direction: 'IN' as const,
  source: 'SALE' as const,
  sourceId: 'sale-1',
  amount: 500,
};

describe('CashLedgerService.post', () => {
  it('normalises businessDate to UTC midnight', async () => {
    await CashLedgerService.post(baseInput);
    expect(entries).toHaveLength(1);
    const stored = entries[0].businessDate as Date;
    expect(stored.getUTCHours()).toBe(0);
    expect(stored.getUTCMinutes()).toBe(0);
    expect(stored.toISOString().slice(0, 10)).toBe('2026-04-22');
  });

  it('is idempotent on (source, sourceId, direction) — P2002 swallowed', async () => {
    await CashLedgerService.post(baseInput);
    await CashLedgerService.post(baseInput);
    await CashLedgerService.post(baseInput);
    expect(entries).toHaveLength(1);
  });

  it('allows same sourceId with different direction (IN + OUT reversal pattern)', async () => {
    await CashLedgerService.post({ ...baseInput, direction: 'IN' });
    await CashLedgerService.post({ ...baseInput, direction: 'OUT' });
    expect(entries).toHaveLength(2);
  });

  it('throws on amount <= 0', async () => {
    await expect(CashLedgerService.post({ ...baseInput, amount: 0 })).rejects.toThrow();
    await expect(CashLedgerService.post({ ...baseInput, amount: -10 })).rejects.toThrow();
  });
});

describe('CashLedgerService.tryPost', () => {
  it('swallows errors (duplicates) — does not throw to caller', async () => {
    await CashLedgerService.tryPost(baseInput);
    await expect(CashLedgerService.tryPost(baseInput)).resolves.toBeUndefined();
  });

  it('swallows unexpected errors (underlying prisma throws)', async () => {
    (prisma.cashLedgerEntry.create as jest.MockedFunction<any>).mockRejectedValueOnce(
      new Error('connection lost')
    );
    await expect(CashLedgerService.tryPost(baseInput)).resolves.toBeUndefined();
  });
});

describe('CashLedgerService.getDaySummary', () => {
  it('aggregates inflows and outflows by source and reports net', async () => {
    await CashLedgerService.post({ ...baseInput, source: 'SALE', sourceId: 's1', amount: 1000 });
    await CashLedgerService.post({ ...baseInput, source: 'SALE', sourceId: 's2', amount: 500 });
    await CashLedgerService.post({ ...baseInput, source: 'CREDIT_RECEIPT', sourceId: 'r1', amount: 200 });
    await CashLedgerService.post({
      ...baseInput,
      direction: 'OUT',
      source: 'EXPENSE',
      sourceId: 'e1',
      amount: 300,
    });

    const summary = await CashLedgerService.getDaySummary(
      'org-1',
      'branch-1',
      '2026-04-22',
    );
    expect(summary.inflows.total).toBe(1700);
    expect(summary.outflows.total).toBe(300);
    expect(summary.net).toBe(1400);
    expect(summary.inflows.bySource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'SALE', total: 1500, count: 2 }),
        expect.objectContaining({ source: 'CREDIT_RECEIPT', total: 200, count: 1 }),
      ]),
    );
    expect(summary.outflows.bySource).toEqual([
      expect.objectContaining({ source: 'EXPENSE', total: 300, count: 1 }),
    ]);
    expect(summary.entries).toHaveLength(4);
  });
});

describe('CashLedgerService.reverse', () => {
  it('marks entry as reversed with reason + user', async () => {
    await CashLedgerService.post(baseInput);
    const entry = entries[0];
    await CashLedgerService.reverse(entry.id, 'user-x', 'test reversal');
    expect(entry.reversedAt).toBeInstanceOf(Date);
    expect(entry.reversedBy).toBe('user-x');
    expect(entry.reversalReason).toBe('test reversal');
  });

  it('double-reversal throws', async () => {
    await CashLedgerService.post(baseInput);
    const entry = entries[0];
    await CashLedgerService.reverse(entry.id, 'user-x', 'first');
    await expect(CashLedgerService.reverse(entry.id, 'user-x', 'second')).rejects.toThrow();
  });

  it('missing entry throws 404', async () => {
    await expect(
      CashLedgerService.reverse('00000000-0000-0000-0000-000000000000', 'user-x', 'nope'),
    ).rejects.toThrow();
  });
});
