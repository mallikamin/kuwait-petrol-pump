/**
 * Unit tests for CustomerAdvanceService.
 *
 * Covered:
 *   - deposit (cash): IN movement + cash ledger IN + QB JE enqueue
 *   - deposit (IBFT/bank_card/pso_card): no cash ledger post
 *   - deposit validation (amount<=0, missing customer, missing bank for
 *     IBFT/bank_card, wrong-org bank)
 *   - cashHandout: balance check, OUT movement, cash ledger OUT, QB JE
 *   - voidMovement for both IN and OUT with correct ledger-source reversal
 *   - voidMovement blocks balance going negative via voiding a deposit
 *   - getBalance math from IN - OUT movements
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
  const banks: any[] = [];
  const movements: any[] = [];
  const ledger: any[] = [];
  const qbConnections: any[] = [];
  const qbQueue: any[] = [];
  let autoId = 1;
  const nextId = (p: string) => `${p}-${autoId++}`;

  return {
    prisma: {
      __branches: branches,
      __customers: customers,
      __banks: banks,
      __movements: movements,
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
      bank: {
        findFirst: jest.fn(async ({ where }: any) =>
          banks.find(
            (b) => b.id === where.id && b.organizationId === where.organizationId,
          ) || null,
        ),
      },
      customerAdvanceMovement: {
        findMany: jest.fn(async ({ where }: any) =>
          movements.filter((m) => {
            if (where.organizationId && m.organizationId !== where.organizationId) return false;
            if (where.customerId && m.customerId !== where.customerId) return false;
            if (where.voidedAt === null && m.voidedAt) return false;
            return true;
          }),
        ),
        count: jest.fn(async ({ where }: any) =>
          movements.filter((m) => {
            if (where.organizationId && m.organizationId !== where.organizationId) return false;
            if (where.customerId && m.customerId !== where.customerId) return false;
            if (where.voidedAt === null && m.voidedAt) return false;
            return true;
          }).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: nextId('cam'),
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            createdAt: new Date('2026-04-22T09:00:00Z'),
            ...data,
          };
          movements.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          movements.find((m) => m.id === where.id) || null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const m = movements.find((x) => x.id === where.id);
          if (!m) throw new Error('movement not found');
          Object.assign(m, data);
          return m;
        }),
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

import { CustomerAdvanceService } from './customer-advance.service';
import { CashLedgerService } from '../cash-ledger/cash-ledger.service';
import { prisma } from '../../config/database';

const branches = (prisma as any).__branches as any[];
const customers = (prisma as any).__customers as any[];
const banks = (prisma as any).__banks as any[];
const movements = (prisma as any).__movements as any[];
const ledger = (prisma as any).__ledger as any[];
const qbConnections = (prisma as any).__qbConnections as any[];
const qbQueue = (prisma as any).__qbQueue as any[];

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const BRANCH = 'branch-1';
const USER = 'user-1';
const CUSTOMER = 'cust-1';
const BANK = 'bank-1';

beforeEach(() => {
  branches.length = 0;
  customers.length = 0;
  banks.length = 0;
  movements.length = 0;
  ledger.length = 0;
  qbConnections.length = 0;
  qbQueue.length = 0;
  jest.clearAllMocks();
  branches.push({ id: BRANCH, organizationId: ORG });
  customers.push({ id: CUSTOMER, organizationId: ORG, name: 'Acme' });
  banks.push({ id: BANK, organizationId: ORG, name: 'HBL' });
});

describe('CustomerAdvanceService.deposit', () => {
  const baseInput = {
    organizationId: ORG,
    userId: USER,
    customerId: CUSTOMER,
    branchId: BRANCH,
    businessDate: '2026-04-22',
    amount: 5000,
  };

  it('cash deposit creates IN movement + cash ledger IN + QB JE', async () => {
    qbConnections.push({ id: 'qbc', organizationId: ORG, isActive: true });
    const m = await CustomerAdvanceService.deposit({ ...baseInput, method: 'cash' });
    expect(m.id).toMatch(/^cam-/);
    expect(movements[0].direction).toBe('IN');
    expect(movements[0].kind).toBe('DEPOSIT_CASH');
    expect(CashLedgerService.tryPost).toHaveBeenCalledTimes(1);
    const call = (CashLedgerService.tryPost as jest.Mock).mock.calls[0][0] as any;
    expect(call.source).toBe('ADVANCE_DEPOSIT');
    expect(call.direction).toBe('IN');
    expect(call.amount).toBe(5000);
    expect(qbQueue).toHaveLength(1);
    expect(qbQueue[0].jobType).toBe('create_advance_deposit_journal');
  });

  it('IBFT deposit does NOT post cash ledger (no drawer impact)', async () => {
    await CustomerAdvanceService.deposit({
      ...baseInput,
      method: 'ibft',
      bankId: BANK,
      referenceNumber: 'IBFT-001',
    });
    expect(movements[0].kind).toBe('DEPOSIT_IBFT');
    expect(CashLedgerService.tryPost).not.toHaveBeenCalled();
  });

  it('bank_card deposit does NOT post cash ledger', async () => {
    await CustomerAdvanceService.deposit({
      ...baseInput,
      method: 'bank_card',
      bankId: BANK,
    });
    expect(movements[0].kind).toBe('DEPOSIT_BANK_CARD');
    expect(CashLedgerService.tryPost).not.toHaveBeenCalled();
  });

  it('pso_card deposit does NOT post cash ledger', async () => {
    await CustomerAdvanceService.deposit({ ...baseInput, method: 'pso_card' });
    expect(movements[0].kind).toBe('DEPOSIT_PSO_CARD');
    expect(CashLedgerService.tryPost).not.toHaveBeenCalled();
  });

  it('rejects amount <= 0', async () => {
    await expect(
      CustomerAdvanceService.deposit({ ...baseInput, method: 'cash', amount: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      CustomerAdvanceService.deposit({ ...baseInput, method: 'cash', amount: -1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('requires bankId for IBFT', async () => {
    await expect(
      CustomerAdvanceService.deposit({ ...baseInput, method: 'ibft' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('requires bankId for bank_card', async () => {
    await expect(
      CustomerAdvanceService.deposit({ ...baseInput, method: 'bank_card' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces org isolation on customer', async () => {
    customers.push({ id: 'other-cust', organizationId: OTHER_ORG });
    await expect(
      CustomerAdvanceService.deposit({
        ...baseInput,
        method: 'cash',
        customerId: 'other-cust',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces org isolation on bank (bankId from other org → 404)', async () => {
    banks.push({ id: 'other-bank', organizationId: OTHER_ORG });
    await expect(
      CustomerAdvanceService.deposit({
        ...baseInput,
        method: 'ibft',
        bankId: 'other-bank',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('CustomerAdvanceService.cashHandout', () => {
  const baseInput = {
    organizationId: ORG,
    userId: USER,
    customerId: CUSTOMER,
    branchId: BRANCH,
    businessDate: '2026-04-22',
    amount: 1000,
  };

  it('handout creates OUT movement + cash ledger OUT when balance sufficient', async () => {
    // seed 2000 advance balance
    movements.push({
      id: 'cam-seed',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 2000,
      voidedAt: null,
    });
    qbConnections.push({ id: 'qbc', organizationId: ORG, isActive: true });
    const m = await CustomerAdvanceService.cashHandout(baseInput);
    expect(m.direction).toBe('OUT');
    expect(m.kind).toBe('CASH_HANDOUT');
    const call = (CashLedgerService.tryPost as jest.Mock).mock.calls[0][0] as any;
    expect(call.source).toBe('DRIVER_HANDOUT');
    expect(call.direction).toBe('OUT');
    expect(call.amount).toBe(1000);
    expect(qbQueue[0].jobType).toBe('create_advance_handout_journal');
  });

  it('rejects when balance insufficient', async () => {
    movements.push({
      id: 'cam-seed',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 500,
      voidedAt: null,
    });
    await expect(CustomerAdvanceService.cashHandout(baseInput)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(CashLedgerService.tryPost).not.toHaveBeenCalled();
  });

  it('rejects amount <= 0', async () => {
    await expect(
      CustomerAdvanceService.cashHandout({ ...baseInput, amount: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('CustomerAdvanceService.voidMovement', () => {
  it('void of OUT (handout) reverses paired DRIVER_HANDOUT ledger entry', async () => {
    movements.push({
      id: 'cam-out',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'OUT',
      amount: 1000,
      voidedAt: null,
    });
    ledger.push({
      id: 'ledger-out',
      source: 'DRIVER_HANDOUT',
      sourceId: 'cam-out',
      reversedAt: null,
    });
    await CustomerAdvanceService.voidMovement(ORG, 'cam-out', USER, 'driver returned');
    expect(movements[0].voidedAt).toBeInstanceOf(Date);
    expect(CashLedgerService.reverse).toHaveBeenCalledWith(
      'ledger-out',
      USER,
      expect.stringContaining('Advance movement void'),
    );
  });

  it('void of IN (cash deposit) reverses paired ADVANCE_DEPOSIT ledger entry', async () => {
    movements.push({
      id: 'cam-in',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 500,
      voidedAt: null,
    });
    ledger.push({
      id: 'ledger-in',
      source: 'ADVANCE_DEPOSIT',
      sourceId: 'cam-in',
      reversedAt: null,
    });
    await CustomerAdvanceService.voidMovement(ORG, 'cam-in', USER, 'duplicate');
    expect(CashLedgerService.reverse).toHaveBeenCalledWith(
      'ledger-in',
      USER,
      expect.any(String),
    );
  });

  it('blocks void of IN when result would be negative balance', async () => {
    // deposit 500, handout 300 → balance 200; voiding the 500 deposit
    // would leave -300 → reject.
    movements.push({
      id: 'cam-in-small',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 500,
      voidedAt: null,
    });
    movements.push({
      id: 'cam-out-big',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'OUT',
      amount: 300,
      voidedAt: null,
    });
    await expect(
      CustomerAdvanceService.voidMovement(ORG, 'cam-in-small', USER, 'oops'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(movements[0].voidedAt).toBeNull();
  });

  it('throws 400 on double-void', async () => {
    movements.push({
      id: 'cam-done',
      organizationId: ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 100,
      voidedAt: new Date(),
    });
    await expect(
      CustomerAdvanceService.voidMovement(ORG, 'cam-done', USER, 'again'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces org isolation on void', async () => {
    movements.push({
      id: 'cam-other',
      organizationId: OTHER_ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 100,
      voidedAt: null,
    });
    await expect(
      CustomerAdvanceService.voidMovement(ORG, 'cam-other', USER, 'cross'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('CustomerAdvanceService.getBalance', () => {
  it('returns IN - OUT for non-voided movements only', async () => {
    movements.push(
      { organizationId: ORG, customerId: CUSTOMER, direction: 'IN', amount: 1000, voidedAt: null },
      { organizationId: ORG, customerId: CUSTOMER, direction: 'IN', amount: 500, voidedAt: null },
      { organizationId: ORG, customerId: CUSTOMER, direction: 'OUT', amount: 300, voidedAt: null },
      { organizationId: ORG, customerId: CUSTOMER, direction: 'IN', amount: 999, voidedAt: new Date() }, // voided, ignored
    );
    const b = await CustomerAdvanceService.getBalance(ORG, CUSTOMER);
    expect(b.inTotal).toBe(1500);
    expect(b.outTotal).toBe(300);
    expect(b.balance).toBe(1200);
  });

  it('returns zero balance for customer with no movements', async () => {
    const b = await CustomerAdvanceService.getBalance(ORG, 'customer-nobody');
    expect(b.balance).toBe(0);
    expect(b.inTotal).toBe(0);
    expect(b.outTotal).toBe(0);
  });

  it('enforces org isolation — movements from other org ignored', async () => {
    movements.push({
      organizationId: OTHER_ORG,
      customerId: CUSTOMER,
      direction: 'IN',
      amount: 99999,
      voidedAt: null,
    });
    const b = await CustomerAdvanceService.getBalance(ORG, CUSTOMER);
    expect(b.balance).toBe(0);
  });
});
