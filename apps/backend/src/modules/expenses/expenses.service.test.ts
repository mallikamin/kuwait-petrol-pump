/**
 * Unit tests for ExpensesService.
 *
 * Covered:
 *   - createEntry happy-path creates ExpenseEntry and posts cash ledger OUT
 *   - createEntry validation (unknown/inactive account, missing branch,
 *     wrong-org account → AppError)
 *   - voidEntry marks entry voided + reverses paired cash ledger entry
 *   - voidEntry blocks double-void
 *   - listAccounts honours includeInactive flag
 *   - createAccount maps P2002 → 409 AppError
 *
 * CashLedgerService is mocked so assertions check the hook parameters
 * rather than re-testing cash-ledger behaviour (covered by
 * cash-ledger.service.test.ts).
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
  const accounts: any[] = [];
  const branches: any[] = [];
  const entries: any[] = [];
  const cashLedgerEntries: any[] = [];
  const qbConnections: any[] = [];
  const qbQueue: any[] = [];

  let autoId = 1;
  const nextId = (prefix: string) => `${prefix}-${autoId++}`;

  return {
    prisma: {
      __accounts: accounts,
      __branches: branches,
      __entries: entries,
      __cashLedgerEntries: cashLedgerEntries,
      __qbConnections: qbConnections,
      __qbQueue: qbQueue,
      expenseAccount: {
        findMany: jest.fn(async ({ where, orderBy: _orderBy }: any) => {
          return accounts.filter((a) => {
            if (where.organizationId !== a.organizationId) return false;
            if (where.isActive !== undefined && a.isActive !== where.isActive) return false;
            return true;
          });
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          accounts.find((a) => a.id === where.id) || null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const duplicate = accounts.find(
            (a) => a.organizationId === data.organizationId && a.label === data.label,
          );
          if (duplicate) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          const row = {
            id: nextId('acct'),
            isActive: true,
            sortOrder: 100,
            ...data,
          };
          accounts.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const a = accounts.find((x) => x.id === where.id);
          if (!a) throw new Error('acct not found');
          Object.assign(a, data);
          return a;
        }),
      },
      branch: {
        findFirst: jest.fn(async ({ where }: any) =>
          branches.find(
            (b) => b.id === where.id && b.organizationId === where.organizationId,
          ) || null,
        ),
      },
      expenseEntry: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: nextId('entry'),
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            createdAt: new Date('2026-04-22T10:00:00Z'),
            ...data,
          };
          entries.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          entries.find((e) => e.id === where.id) || null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const e = entries.find((x) => x.id === where.id);
          if (!e) throw new Error('entry not found');
          Object.assign(e, data);
          return e;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return entries.filter((e) => {
            if (where.organizationId && e.organizationId !== where.organizationId) return false;
            if (where.branchId && e.branchId !== where.branchId) return false;
            if (where.voidedAt === null && e.voidedAt) return false;
            return true;
          });
        }),
        count: jest.fn(async ({ where }: any) => {
          return entries.filter((e) => {
            if (where.organizationId && e.organizationId !== where.organizationId) return false;
            if (where.branchId && e.branchId !== where.branchId) return false;
            if (where.voidedAt === null && e.voidedAt) return false;
            return true;
          }).length;
        }),
      },
      cashLedgerEntry: {
        findFirst: jest.fn(async ({ where }: any) =>
          cashLedgerEntries.find(
            (c) =>
              c.source === where.source &&
              c.sourceId === where.sourceId &&
              (!where.direction || c.direction === where.direction),
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

import { ExpensesService } from './expenses.service';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

const accounts = (prisma as any).__accounts as any[];
const branches = (prisma as any).__branches as any[];
const entries = (prisma as any).__entries as any[];
const cashLedgerEntries = (prisma as any).__cashLedgerEntries as any[];
const qbConnections = (prisma as any).__qbConnections as any[];
const qbQueue = (prisma as any).__qbQueue as any[];

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const BRANCH = 'branch-1';
const USER = 'user-1';

beforeEach(() => {
  accounts.length = 0;
  branches.length = 0;
  entries.length = 0;
  cashLedgerEntries.length = 0;
  qbConnections.length = 0;
  qbQueue.length = 0;
  jest.clearAllMocks();
  branches.push({ id: BRANCH, organizationId: ORG });
  accounts.push({
    id: 'acct-seed',
    organizationId: ORG,
    label: 'Cleaning Expense',
    qbAccountName: 'Admin Expenses:Cleaning Expense',
    isActive: true,
    sortOrder: 10,
  });
});

describe('ExpensesService.createEntry', () => {
  const baseInput = {
    organizationId: ORG,
    branchId: BRANCH,
    businessDate: '2026-04-22',
    expenseAccountId: 'acct-seed',
    amount: 1500,
    memo: 'Window cleaner',
    userId: USER,
  };

  it('creates entry, posts cash ledger OUT with source=EXPENSE, enqueues QB job when connection exists', async () => {
    qbConnections.push({ id: 'qbc-1', organizationId: ORG, isActive: true });
    const entry = await ExpensesService.createEntry(baseInput);
    expect(entry.id).toMatch(/^entry-/);
    expect(entries).toHaveLength(1);
    expect(CashLedgerService.tryPost).toHaveBeenCalledTimes(1);
    const call = (CashLedgerService.tryPost as jest.Mock).mock.calls[0][0] as any;
    expect(call.direction).toBe('OUT');
    expect(call.source).toBe('EXPENSE');
    expect(call.sourceId).toBe(entry.id);
    expect(call.amount).toBe(1500);
    expect(call.organizationId).toBe(ORG);
    expect(qbQueue).toHaveLength(1);
    expect(qbQueue[0].jobType).toBe('create_cash_expense');
    expect(qbQueue[0].payload.qbAccountName).toBe('Admin Expenses:Cleaning Expense');
  });

  it('does not enqueue QB job when no active connection (persistence still succeeds)', async () => {
    const entry = await ExpensesService.createEntry(baseInput);
    expect(entry.id).toBeDefined();
    expect(qbQueue).toHaveLength(0);
    expect(CashLedgerService.tryPost).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when expense account does not exist', async () => {
    await expect(
      ExpensesService.createEntry({ ...baseInput, expenseAccountId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces org isolation — expense account from different org → 404', async () => {
    accounts.push({
      id: 'acct-other-org',
      organizationId: OTHER_ORG,
      label: 'Other',
      qbAccountName: null,
      isActive: true,
      sortOrder: 10,
    });
    await expect(
      ExpensesService.createEntry({ ...baseInput, expenseAccountId: 'acct-other-org' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(entries).toHaveLength(0);
  });

  it('rejects inactive expense account with 400', async () => {
    accounts[0].isActive = false;
    await expect(ExpensesService.createEntry(baseInput)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('throws 404 when branch does not exist', async () => {
    await expect(
      ExpensesService.createEntry({ ...baseInput, branchId: 'missing-branch' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces org isolation — branch from different org → 404', async () => {
    branches.push({ id: 'branch-other', organizationId: OTHER_ORG });
    await expect(
      ExpensesService.createEntry({ ...baseInput, branchId: 'branch-other' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('ExpensesService.voidEntry', () => {
  beforeEach(async () => {
    entries.push({
      id: 'entry-1',
      organizationId: ORG,
      branchId: BRANCH,
      expenseAccountId: 'acct-seed',
      amount: 1500,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
    cashLedgerEntries.push({
      id: 'ledger-1',
      source: 'EXPENSE',
      sourceId: 'entry-1',
      direction: 'OUT',
      reversedAt: null,
    });
  });

  it('marks entry voided and reverses paired cash ledger post', async () => {
    await ExpensesService.voidEntry(ORG, 'entry-1', USER, 'user requested');
    const e = entries.find((x) => x.id === 'entry-1');
    expect(e?.voidedAt).toBeInstanceOf(Date);
    expect(e?.voidedBy).toBe(USER);
    expect(e?.voidReason).toBe('user requested');
    expect(CashLedgerService.reverse).toHaveBeenCalledWith(
      'ledger-1',
      USER,
      expect.stringContaining('Expense void'),
    );
  });

  it('throws 400 on double-void', async () => {
    entries[0].voidedAt = new Date();
    await expect(
      ExpensesService.voidEntry(ORG, 'entry-1', USER, 'again'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces org isolation — void from different org → 404', async () => {
    await expect(
      ExpensesService.voidEntry(OTHER_ORG, 'entry-1', USER, 'cross-org'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('skips ledger reversal when paired ledger entry is already reversed', async () => {
    cashLedgerEntries[0].reversedAt = new Date();
    await ExpensesService.voidEntry(ORG, 'entry-1', USER, 'already reversed');
    expect(CashLedgerService.reverse).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.listAccounts', () => {
  it('includes only active accounts by default', async () => {
    accounts.push({
      id: 'acct-inactive',
      organizationId: ORG,
      label: 'Inactive',
      qbAccountName: null,
      isActive: false,
      sortOrder: 100,
    });
    const got = await ExpensesService.listAccounts(ORG, false);
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe('acct-seed');
  });

  it('includes inactive when flag is true', async () => {
    accounts.push({
      id: 'acct-inactive',
      organizationId: ORG,
      label: 'Inactive',
      qbAccountName: null,
      isActive: false,
      sortOrder: 100,
    });
    const got = await ExpensesService.listAccounts(ORG, true);
    expect(got).toHaveLength(2);
  });

  it('enforces org isolation', async () => {
    accounts.push({
      id: 'other-org-acct',
      organizationId: OTHER_ORG,
      label: 'Other',
      qbAccountName: null,
      isActive: true,
      sortOrder: 100,
    });
    const got = await ExpensesService.listAccounts(ORG, true);
    expect(got.every((a: any) => a.organizationId === ORG)).toBe(true);
  });
});

describe('ExpensesService.createAccount', () => {
  it('maps P2002 (duplicate label) → 409 AppError', async () => {
    await expect(
      ExpensesService.createAccount({
        organizationId: ORG,
        label: 'Cleaning Expense', // already seeded
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates new account with qbAccountName + sortOrder', async () => {
    const a = await ExpensesService.createAccount({
      organizationId: ORG,
      label: 'New Label',
      qbAccountName: 'Admin Expenses:New Label',
      sortOrder: 250,
    });
    expect(a.id).toMatch(/^acct-/);
    expect(accounts).toHaveLength(2);
  });
});
