/**
 * Unit tests for computeStockAtDate.
 *
 * Verifies:
 *   - bookQty formula: bootstrap + purchases - sales + priorGainLoss
 *   - StockReceiptItem (per-receipt) is preferred over PO cumulative qty
 *   - Same-day gain/loss entries are EXCLUDED from priorGainLossQty
 *     (so a new entry can be computed against an unmuddied book stock)
 *   - lastPurchaseRate falls back to PO item costPerUnit when no receipt
 *     line carries a rate
 *   - lastPurchaseRate is null when no purchase exists at/before asOfDate
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../config/database', () => ({
  prisma: {
    fuelType: { findUnique: jest.fn() },
    inventoryBootstrap: { findFirst: jest.fn() },
    stockReceipt: { findMany: jest.fn() },
    purchaseOrder: { findMany: jest.fn() },
    fuelSale: { findMany: jest.fn() },
    monthlyInventoryGainLoss: { findMany: jest.fn() },
    purchaseOrderItem: { findFirst: jest.fn() },
  },
}));

import { prisma } from '../../config/database';
import { computeStockAtDate } from './stock-at-date.service';

const mockFn = (m: any) => m as jest.MockedFunction<any>;

describe('computeStockAtDate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFn(prisma.fuelType.findUnique).mockResolvedValue({
      id: 'fuel-HSD',
      code: 'HSD',
      name: 'High Speed Diesel',
    });
    mockFn(prisma.inventoryBootstrap.findFirst).mockResolvedValue(null);
    mockFn(prisma.stockReceipt.findMany).mockResolvedValue([]);
    mockFn(prisma.purchaseOrder.findMany).mockResolvedValue([]);
    mockFn(prisma.fuelSale.findMany).mockResolvedValue([]);
    mockFn(prisma.monthlyInventoryGainLoss.findMany).mockResolvedValue([]);
    mockFn(prisma.purchaseOrderItem.findFirst).mockResolvedValue(null);
  });

  it('returns zeros when no bootstrap, purchases, sales, or gain/loss exist', async () => {
    const r = await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });
    expect(r.bookQty).toBe(0);
    expect(r.bootstrapQty).toBe(0);
    expect(r.purchasesQty).toBe(0);
    expect(r.soldQty).toBe(0);
    expect(r.priorGainLossQty).toBe(0);
    expect(r.lastPurchaseRate).toBeNull();
  });

  it('uses bootstrap quantity as the opening anchor', async () => {
    mockFn(prisma.inventoryBootstrap.findFirst).mockResolvedValue({
      id: 'boot-1',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
      quantity: 10000,
    });
    const r = await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });
    expect(r.bootstrapQty).toBe(10000);
    expect(r.bookQty).toBe(10000);
  });

  it('book = bootstrap + purchases - sales + prior gain/loss', async () => {
    mockFn(prisma.inventoryBootstrap.findFirst).mockResolvedValue({
      id: 'boot-1',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
      quantity: 10000,
    });
    // 5000 L received with per-receipt items
    mockFn(prisma.stockReceipt.findMany).mockResolvedValue([
      {
        id: 'r1',
        receiptDate: new Date('2026-02-01T10:00:00Z'),
        purchaseOrderId: 'po1',
        items: [{ poItemId: 'poi1', quantityReceived: 5000 }],
        purchaseOrder: {
          items: [
            {
              id: 'poi1',
              fuelType: { code: 'HSD' },
              costPerUnit: 280,
              quantityReceived: 5000,
            },
          ],
        },
      },
    ]);
    // 3000 L sold
    mockFn(prisma.fuelSale.findMany).mockResolvedValue([{ quantityLiters: 3000 }]);
    // -50 L prior gain/loss (loss)
    mockFn(prisma.monthlyInventoryGainLoss.findMany).mockResolvedValue([
      { quantity: -50 },
    ]);

    const r = await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });
    // 10000 + 5000 - 3000 - 50 = 11950
    expect(r.bookQty).toBe(11950);
    expect(r.purchasesQty).toBe(5000);
    expect(r.soldQty).toBe(3000);
    expect(r.priorGainLossQty).toBe(-50);
  });

  it('uses StockReceiptItem per-receipt qty (not PO cumulative)', async () => {
    // Two receipts on the same PO. The PO cumulative quantityReceived would
    // be 8000 (4000 + 4000) — naïve PO-summing would double-count it as 16000.
    // The per-receipt path should give 8000 total.
    mockFn(prisma.stockReceipt.findMany).mockResolvedValue([
      {
        id: 'r1',
        receiptDate: new Date('2026-02-01T10:00:00Z'),
        purchaseOrderId: 'po1',
        items: [{ poItemId: 'poi1', quantityReceived: 4000 }],
        purchaseOrder: {
          items: [
            { id: 'poi1', fuelType: { code: 'HSD' }, costPerUnit: 280, quantityReceived: 8000 },
          ],
        },
      },
      {
        id: 'r2',
        receiptDate: new Date('2026-02-15T10:00:00Z'),
        purchaseOrderId: 'po1',
        items: [{ poItemId: 'poi1', quantityReceived: 4000 }],
        purchaseOrder: {
          items: [
            { id: 'poi1', fuelType: { code: 'HSD' }, costPerUnit: 280, quantityReceived: 8000 },
          ],
        },
      },
    ]);

    const r = await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });
    expect(r.purchasesQty).toBe(8000); // not 16000
  });

  it('excludes same-day gain/loss entries from priorGainLossQty', async () => {
    // Same-day entry must NOT fold into the basis used to compute a fresh
    // gain/loss on that same date. The findMany filter uses lt: dayStart so
    // we verify it was called with the strict-less-than cutoff.
    mockFn(prisma.monthlyInventoryGainLoss.findMany).mockResolvedValue([]);

    await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });

    const calls = mockFn(prisma.monthlyInventoryGainLoss.findMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const where = calls[0][0].where;
    expect(where.businessDate.lt).toEqual(new Date('2026-04-25T00:00:00.000Z'));
    expect(where.businessDate.gte).toBeDefined();
  });

  it('falls back to PO costPerUnit when no receipt line had a rate', async () => {
    // No receipts found, but a PO exists with costPerUnit set.
    mockFn(prisma.purchaseOrderItem.findFirst).mockResolvedValue({
      id: 'poi1',
      costPerUnit: 295.5,
      purchaseOrder: {
        receivedDate: new Date('2026-02-01T00:00:00Z'),
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      },
    });

    const r = await computeStockAtDate({
      branchId: 'b1',
      fuelTypeId: 'fuel-HSD',
      asOfDate: '2026-04-25',
    });
    expect(r.lastPurchaseRate).toBe(295.5);
    expect(r.lastPurchaseDate).toBe('2026-02-01');
  });
});
