/**
 * Tests for MonthlyGainLossService.createByDate (the new date-keyed flow).
 *
 * Behaviour covered:
 *   - measuredQty path: quantity = measured - bookQtyAtDate (auto-computed)
 *   - direct quantity path: quantity passed through as-is, measuredQty stays null
 *   - lastPurchaseRate snapshotted from computeStockAtDate
 *   - valueAtRate = quantity * lastPurchaseRate (frozen at write time)
 *   - month is auto-derived from businessDate
 *   - duplicate (branch, fuel, date) rejected
 *   - future-dated entries rejected
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../config/database', () => ({
  prisma: {
    fuelType: { findUnique: jest.fn() },
    branch: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    monthlyInventoryGainLoss: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    fuelInventory: { findUnique: jest.fn() },
    qBConnection: { findFirst: jest.fn() },
    qBSyncQueue: { create: jest.fn() },
  },
}));

jest.mock('./stock-at-date.service', () => ({
  computeStockAtDate: jest.fn(),
}));

import { prisma } from '../../config/database';
import { computeStockAtDate } from './stock-at-date.service';
import { MonthlyGainLossService } from './monthly-gain-loss.service';

const mockFn = (m: any) => m as jest.MockedFunction<any>;
const svc = new MonthlyGainLossService();

function seedDefaults() {
  jest.clearAllMocks();
  mockFn(prisma.branch.findFirst).mockResolvedValue({
    id: 'b1',
    organizationId: 'org1',
    name: 'Main Branch',
  });
  mockFn(prisma.fuelType.findUnique).mockResolvedValue({
    id: 'fuel-HSD',
    code: 'HSD',
    name: 'High Speed Diesel',
  });
  mockFn(prisma.user.findUnique).mockResolvedValue({ id: 'u1' });
  mockFn(prisma.monthlyInventoryGainLoss.findFirst).mockResolvedValue(null);
  mockFn(prisma.qBConnection.findFirst).mockResolvedValue(null);
  mockFn(computeStockAtDate).mockResolvedValue({
    branchId: 'b1',
    fuelTypeId: 'fuel-HSD',
    fuelCode: 'HSD',
    asOfDate: '2026-04-25',
    bootstrapQty: 10000,
    purchasesQty: 0,
    soldQty: 0,
    priorGainLossQty: 0,
    bookQty: 10000,
    lastPurchaseRate: 285.5,
    lastPurchaseDate: '2026-02-01',
  });
  mockFn(prisma.monthlyInventoryGainLoss.create).mockImplementation(async ({ data }: any) => ({
    id: 'gl-1',
    branchId: data.branchId,
    fuelTypeId: data.fuelTypeId,
    businessDate: data.businessDate,
    month: data.month,
    quantity: { toString: () => String(Number(data.quantity)) },
    measuredQty: data.measuredQty
      ? { toString: () => String(Number(data.measuredQty)) }
      : null,
    bookQtyAtDate: data.bookQtyAtDate
      ? { toString: () => String(Number(data.bookQtyAtDate)) }
      : null,
    lastPurchaseRate: data.lastPurchaseRate
      ? { toString: () => String(Number(data.lastPurchaseRate)) }
      : null,
    valueAtRate: data.valueAtRate
      ? { toString: () => String(Number(data.valueAtRate)) }
      : null,
    remarks: data.remarks,
    recordedBy: data.recordedBy,
    recordedAt: new Date('2026-04-25T10:00:00Z'),
    fuelType: { id: 'fuel-HSD', code: 'HSD', name: 'High Speed Diesel' },
    user: { id: 'u1', username: 'alice', fullName: 'Alice' },
  }));
}

describe('MonthlyGainLossService.createByDate', () => {
  beforeEach(seedDefaults);

  it('measuredQty path: quantity = measured - bookQty (loss)', async () => {
    // Book = 10000 L; measured 9850 L → loss of 150 L.
    const result = await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-04-25',
      measuredQty: 9850,
      recordedBy: 'u1',
    });

    expect(result.quantity).toBe(-150);
    expect(result.measuredQty).toBe(9850);
    expect(result.bookQtyAtDate).toBe(10000);
  });

  it('measuredQty path: positive delta = gain', async () => {
    const result = await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-04-25',
      measuredQty: 10025,
      recordedBy: 'u1',
    });
    expect(result.quantity).toBe(25);
  });

  it('captures lastPurchaseRate and computes valueAtRate (qty * rate)', async () => {
    const result = await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-04-25',
      measuredQty: 9900,
      recordedBy: 'u1',
    });
    // qty = 9900 - 10000 = -100; rate = 285.5
    expect(result.lastPurchaseRate).toBe(285.5);
    expect(result.valueAtRate).toBe(-28550);
  });

  it('valueAtRate is null when no purchase rate is available', async () => {
    mockFn(computeStockAtDate).mockResolvedValueOnce({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      fuelCode: 'HSD',
      asOfDate: '2026-04-25',
      bootstrapQty: 10000,
      purchasesQty: 0,
      soldQty: 0,
      priorGainLossQty: 0,
      bookQty: 10000,
      lastPurchaseRate: null,
      lastPurchaseDate: null,
    });

    const result = await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-04-25',
      measuredQty: 9900,
      recordedBy: 'u1',
    });
    expect(result.lastPurchaseRate).toBeNull();
    expect(result.valueAtRate).toBeNull();
  });

  it('direct quantity path: passes through, measuredQty stays null', async () => {
    const result = await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-04-25',
      quantity: -77.5,
      recordedBy: 'u1',
    });
    expect(result.quantity).toBe(-77.5);
    expect(result.measuredQty).toBeNull();
  });

  it('auto-derives month from businessDate', async () => {
    await svc.createByDate({
      organizationId: 'org1',
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      businessDate: '2026-03-15',
      measuredQty: 10000,
      recordedBy: 'u1',
    });
    const args = mockFn(prisma.monthlyInventoryGainLoss.create).mock.calls[0][0];
    expect(args.data.month).toBe('2026-03');
  });

  it('rejects future-dated entries', async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
    const futureDate = tomorrow.toISOString().slice(0, 10);

    await expect(
      svc.createByDate({
        organizationId: 'org1',
        branchId: 'b1',
        fuelTypeId: 'fuel-HSD',
        businessDate: futureDate,
        measuredQty: 10000,
        recordedBy: 'u1',
      }),
    ).rejects.toThrow(/future/);
  });

  it('rejects duplicate (branch, fuel, businessDate)', async () => {
    mockFn(prisma.monthlyInventoryGainLoss.findFirst).mockResolvedValueOnce({
      id: 'existing',
    });
    await expect(
      svc.createByDate({
        organizationId: 'org1',
        branchId: 'b1',
        fuelTypeId: 'fuel-HSD',
        businessDate: '2026-04-25',
        measuredQty: 9900,
        recordedBy: 'u1',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('requires either measuredQty or quantity', async () => {
    await expect(
      svc.createByDate({
        organizationId: 'org1',
        branchId: 'b1',
        fuelTypeId: 'fuel-HSD',
        businessDate: '2026-04-25',
        recordedBy: 'u1',
      }),
    ).rejects.toThrow(/measuredQty or quantity/);
  });
});
