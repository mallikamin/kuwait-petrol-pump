/**
 * Regression tests for the QB enqueue hook in monthly-gain-loss.service.
 *
 * Behaviour covered:
 *   - After a gain/loss row is committed, a JournalEntry job is enqueued
 *     with variant derived from the sign of quantity.
 *   - costPerLitre is sourced from FuelInventory.avgCostPerLiter (the
 *     closest running value to the workbook's "Last Purchase Cost").
 *   - If no avgCostPerLiter is available, enqueue is skipped with a warning
 *     (enqueueing a zero-cost JE would silently noop in QB).
 *   - Enqueue errors never bubble out of createEntry.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MonthlyGainLossService } from './monthly-gain-loss.service';

jest.mock('../../config/database', () => ({
  prisma: {
    fuelType: { findUnique: jest.fn() },
    branch: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    monthlyInventoryGainLoss: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    fuelInventory: { findUnique: jest.fn() },
    qBConnection: { findFirst: jest.fn() },
    qBSyncQueue: { create: jest.fn() },
  },
}));

import { prisma } from '../../config/database';

const svc = new MonthlyGainLossService();

function seedBase() {
  jest.clearAllMocks();
  (prisma.fuelType.findUnique as jest.MockedFunction<any>).mockResolvedValue({
    id: 'fuel-HSD', code: 'HSD', name: 'HSD',
  } as any);
  (prisma.branch.findUnique as jest.MockedFunction<any>).mockResolvedValue({
    id: 'b-1', organizationId: 'org-1', name: 'Main Branch',
  } as any);
  (prisma.user.findUnique as jest.MockedFunction<any>).mockResolvedValue({ id: 'u-1' } as any);
  (prisma.monthlyInventoryGainLoss.findUnique as jest.MockedFunction<any>).mockResolvedValue(null);
  (prisma.monthlyInventoryGainLoss.create as jest.MockedFunction<any>).mockImplementation(async ({ data }: any) => ({
    id: 'gl-1',
    branchId: data.branchId,
    fuelTypeId: data.fuelTypeId,
    month: data.month,
    quantity: { toString: () => String(Number(data.quantity)) },
    remarks: data.remarks,
    recordedBy: data.recordedBy,
    recordedAt: new Date('2026-04-19T00:00:00Z'),
    fuelType: { id: 'fuel-HSD', code: 'HSD', name: 'HSD' },
    user: { id: 'u-1', username: 'a', fullName: 'Alice' },
  } as any));
  (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue({
    id: 'qb-conn-1', organizationId: 'org-1', isActive: true,
  } as any);
  (prisma.qBSyncQueue.create as jest.MockedFunction<any>).mockResolvedValue({} as any);
}

describe('MonthlyGainLossService.createEntry → QB enqueue (S11)', () => {
  beforeEach(seedBase);

  it('positive qty → variant=gain, quantityLitres=abs(qty), cost from FuelInventory.avgCostPerLiter', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue({
      avgCostPerLiter: { toString: () => '265.5' },
    } as any);

    await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: 20, remarks: null as any, recordedBy: 'u-1',
    } as any);

    expect(prisma.qBSyncQueue.create).toHaveBeenCalledTimes(1);
    const args = (prisma.qBSyncQueue.create as jest.MockedFunction<any>).mock.calls[0][0] as any;
    expect(args.data.jobType).toBe('create_journal_entry');
    expect(args.data.entityType).toBe('inventory_adjustment');
    expect(args.data.entityId).toBe('gl-1');
    expect(args.data.idempotencyKey).toBe('qb-dipvar-gl-1');
    expect(args.data.payload).toEqual(expect.objectContaining({
      gainLossId: 'gl-1',
      fuelCode: 'HSD',
      variant: 'gain',
      quantityLitres: 20,
      costPerLitre: 265.5,
      monthLabel: '2026-04',
      branchName: 'Main Branch',
    }));
  });

  it('negative qty → variant=loss, quantityLitres=abs(qty)', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue({
      avgCostPerLiter: { toString: () => '260' },
    } as any);

    await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: -15, recordedBy: 'u-1',
    } as any);

    const args = (prisma.qBSyncQueue.create as jest.MockedFunction<any>).mock.calls[0][0] as any;
    expect(args.data.payload.variant).toBe('loss');
    expect(args.data.payload.quantityLitres).toBe(15);
  });

  it('no FuelInventory row → skips enqueue (warning logged, entry still persists)', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue(null);

    const result = await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: 5, recordedBy: 'u-1',
    } as any);

    expect(prisma.qBSyncQueue.create).not.toHaveBeenCalled();
    expect((result as any).id).toBe('gl-1');
  });

  it('avgCostPerLiter=0 → skips enqueue (zero-cost JE would noop in QB)', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue({
      avgCostPerLiter: { toString: () => '0' },
    } as any);

    await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: 5, recordedBy: 'u-1',
    } as any);

    expect(prisma.qBSyncQueue.create).not.toHaveBeenCalled();
  });

  it('qty=0 → no enqueue (no variance to book)', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue({
      avgCostPerLiter: { toString: () => '260' },
    } as any);

    await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: 0, recordedBy: 'u-1',
    } as any);

    expect(prisma.qBSyncQueue.create).not.toHaveBeenCalled();
  });

  it('enqueue DB error → swallowed (gain/loss entry still returned)', async () => {
    (prisma.fuelInventory.findUnique as jest.MockedFunction<any>).mockResolvedValue({
      avgCostPerLiter: { toString: () => '260' },
    } as any);
    (prisma.qBSyncQueue.create as jest.MockedFunction<any>).mockRejectedValue(new Error('boom'));

    const result = await svc.createEntry({
      branchId: 'b-1', fuelTypeId: 'fuel-HSD', month: '2026-04',
      quantity: 10, recordedBy: 'u-1',
    } as any);
    expect((result as any).id).toBe('gl-1');
  });
});
