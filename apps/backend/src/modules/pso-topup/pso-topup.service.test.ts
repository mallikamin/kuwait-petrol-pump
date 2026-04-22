/**
 * Unit tests for PsoTopupService.
 *
 * Covered:
 *   - create happy-path: persist topup, post cash ledger IN, enqueue QB JE
 *   - create validation (amount <=0, missing branch, wrong-org customer)
 *   - create without customerId (anonymous PSO card holder) still works
 *   - voidEntry marks voided, reverses paired cash ledger IN post
 *   - voidEntry blocks double-void
 *   - org isolation on void
 *   - list default filters out voided entries
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../cash-ledger/cash-ledger.service', () => ({
  CashLedgerService: {
    tryPost: jest.fn(async () => undefined),
    reverse: jest.fn(async () => undefined),
    getDaySummary: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../../config/database', () => {
  const branches: any[] = [];
  const customers: any[] = [];
  const topups: any[] = [];
  const ledger: any[] = [];
  const qbConnections: any[] = [];
  const qbQueue: any[] = [];
  let autoId = 1;
  const nextId = (p: string) => `${p}-${autoId++}`;

  return {
    prisma: {
      __branches: branches,
      __customers: customers,
      __topups: topups,
      __ledger: ledger,
      __qbConnections: qbConnections,
      __qbQueue: qbQueue,
      branch: {
        findFirst: jest.fn(async ({ where }: any) =>
          branches.find(
            (b) => b.id === where.id && b.organizationId === where.organizationId,
          ) || null,
        ),
      },
      customer: {
        findFirst: jest.fn(async ({ where }: any) =>
          customers.find(
            (c) => c.id === where.id && c.organizationId === where.organizationId,
          ) || null,
        ),
      },
      psoTopup: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: nextId('topup'),
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            createdAt: new Date('2026-04-22T09:00:00Z'),
            ...data,
          };
          topups.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          topups.find((t) => t.id === where.id) || null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const t = topups.find((x) => x.id === where.id);
          if (!t) throw new Error('topup not found');
          Object.assign(t, data);
          return t;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          topups.filter((t) => {
            if (where.organizationId && t.organizationId !== where.organizationId) return false;
            if (where.branchId && t.branchId !== where.branchId) return false;
            if (where.voidedAt === null && t.voidedAt) return false;
            return true;
          }),
        ),
        count: jest.fn(async ({ where }: any) =>
          topups.filter((t) => {
            if (where.organizationId && t.organizationId !== where.organizationId) return false;
            if (where.branchId && t.branchId !== where.branchId) return false;
            if (where.voidedAt === null && t.voidedAt) return false;
            return true;
          }).length,
        ),
      },
      cashLedgerEntry: {
        findFirst: jest.fn(async ({ where }: any) =>
          ledger.find(
            (l) =>
              l.source === where.source &&
              l.sourceId === where.sourceId &&
              (!where.direction || l.direction === where.direction),
          ) || null,
        ),
      },
      qBConnection: {
        findFirst: jest.fn(async ({ where }: any) =>
          qbConnections.find(
            (c) => c.organizationId === where.organizationId && c.isActive === true,
          ) || null,
        ),
      },
      qBSyncQueue: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: nextId('job'), ...data };
          qbQueue.push(row);
          return row;
        }),
      },
    },
  };
});

import { PsoTopupService } from './pso-topup.service';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';
import { prisma } from '../../config/database';

const branches = (prisma as any).__branches as any[];
const customers = (prisma as any).__customers as any[];
const topups = (prisma as any).__topups as any[];
const ledger = (prisma as any).__ledger as any[];
const qbConnections = (prisma as any).__qbConnections as any[];
const qbQueue = (prisma as any).__qbQueue as any[];

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const BRANCH = 'branch-1';
const USER = 'user-1';
const CUSTOMER = 'cust-1';

beforeEach(() => {
  branches.length = 0;
  customers.length = 0;
  topups.length = 0;
  ledger.length = 0;
  qbConnections.length = 0;
  qbQueue.length = 0;
  jest.clearAllMocks();
  branches.push({ id: BRANCH, organizationId: ORG });
  customers.push({ id: CUSTOMER, organizationId: ORG, name: 'Acme Transport' });
});

describe('PsoTopupService.create', () => {
  const baseInput = {
    organizationId: ORG,
    userId: USER,
    branchId: BRANCH,
    businessDate: '2026-04-22',
    customerId: CUSTOMER,
    psoCardLast4: '1234',
    amount: 10000,
  };

  it('creates topup, posts cash ledger IN with source=PSO_TOPUP, enqueues QB JE when connection exists', async () => {
    qbConnections.push({ id: 'qbc-1', organizationId: ORG, isActive: true });
    const topup = await PsoTopupService.create(baseInput);
    expect(topups).toHaveLength(1);
    expect(topup.id).toMatch(/^topup-/);
    expect(CashLedgerService.tryPost).toHaveBeenCalledTimes(1);
    const call = (CashLedgerService.tryPost as jest.Mock).mock.calls[0][0] as any;
    expect(call.direction).toBe('IN');
    expect(call.source).toBe('PSO_TOPUP');
    expect(call.sourceId).toBe(topup.id);
    expect(call.amount).toBe(10000);
    expect(qbQueue).toHaveLength(1);
    expect(qbQueue[0].jobType).toBe('create_pso_topup_journal');
  });

  it('works without customerId (anonymous topup)', async () => {
    const topup = await PsoTopupService.create({ ...baseInput, customerId: undefined });
    expect(topup.customerId).toBeNull();
    expect(CashLedgerService.tryPost).toHaveBeenCalledTimes(1);
  });

  it('rejects amount <= 0', async () => {
    await expect(
      PsoTopupService.create({ ...baseInput, amount: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      PsoTopupService.create({ ...baseInput, amount: -100 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 on missing branch', async () => {
    await expect(
      PsoTopupService.create({ ...baseInput, branchId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces org isolation on branch (branch from other org → 404)', async () => {
    branches.push({ id: 'branch-x', organizationId: OTHER_ORG });
    await expect(
      PsoTopupService.create({ ...baseInput, branchId: 'branch-x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(topups).toHaveLength(0);
  });

  it('enforces org isolation on customer (customer from other org → 404)', async () => {
    customers.push({ id: 'other-cust', organizationId: OTHER_ORG });
    await expect(
      PsoTopupService.create({ ...baseInput, customerId: 'other-cust' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not enqueue QB job when no connection (topup still persisted)', async () => {
    const topup = await PsoTopupService.create(baseInput);
    expect(topup.id).toBeDefined();
    expect(qbQueue).toHaveLength(0);
  });
});

describe('PsoTopupService.voidEntry', () => {
  beforeEach(() => {
    topups.push({
      id: 'topup-1',
      organizationId: ORG,
      branchId: BRANCH,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
    ledger.push({
      id: 'ledger-topup',
      source: 'PSO_TOPUP',
      sourceId: 'topup-1',
      direction: 'IN',
      reversedAt: null,
    });
  });

  it('marks voided and reverses paired IN ledger entry', async () => {
    await PsoTopupService.voidEntry(ORG, 'topup-1', USER, 'wrong amount');
    expect(topups[0].voidedAt).toBeInstanceOf(Date);
    expect(topups[0].voidReason).toBe('wrong amount');
    expect(CashLedgerService.reverse).toHaveBeenCalledWith(
      'ledger-topup',
      USER,
      expect.stringContaining('PSO top-up void'),
    );
  });

  it('throws 400 on double-void', async () => {
    topups[0].voidedAt = new Date();
    await expect(
      PsoTopupService.voidEntry(ORG, 'topup-1', USER, 'again'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces org isolation on void', async () => {
    await expect(
      PsoTopupService.voidEntry(OTHER_ORG, 'topup-1', USER, 'cross-org'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(topups[0].voidedAt).toBeNull();
  });
});

describe('PsoTopupService.list', () => {
  it('default excludes voided entries', async () => {
    topups.push({
      id: 'active',
      organizationId: ORG,
      branchId: BRANCH,
      voidedAt: null,
    });
    topups.push({
      id: 'voided',
      organizationId: ORG,
      branchId: BRANCH,
      voidedAt: new Date(),
    });
    const { items, total } = await PsoTopupService.list({
      organizationId: ORG,
      branchId: BRANCH,
    });
    expect(total).toBe(1);
    expect(items[0].id).toBe('active');
  });

  it('includeVoided=true surfaces voided entries', async () => {
    topups.push({
      id: 'active',
      organizationId: ORG,
      branchId: BRANCH,
      voidedAt: null,
    });
    topups.push({
      id: 'voided',
      organizationId: ORG,
      branchId: BRANCH,
      voidedAt: new Date(),
    });
    const { total } = await PsoTopupService.list({
      organizationId: ORG,
      branchId: BRANCH,
      includeVoided: true,
    });
    expect(total).toBe(2);
  });
});
