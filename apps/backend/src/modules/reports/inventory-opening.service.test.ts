import { computeInventoryOpeningClosing } from './inventory-opening.service';
import { prisma } from '../../config/database';

jest.mock('../../config/database', () => ({
  prisma: {
    inventoryBootstrap: { findMany: jest.fn() },
    stockReceipt: { findMany: jest.fn() },
    purchaseOrder: { findMany: jest.fn() },
    sale: { findMany: jest.fn() },
    monthlyInventoryGainLoss: { findMany: jest.fn() },
  },
}));

const branchId = 'branch-1';
const productId = 'prod-1';

const bootstrap = (qty: number, asOfDate = new Date('2026-01-01T00:00:00Z')) => ({
  id: 'b1',
  branchId,
  productId,
  fuelTypeId: null,
  asOfDate,
  quantity: qty as any, // Prisma Decimal - Number() coerces in the service
  source: 'bootstrap_2026-01-01',
  product: { id: productId },
  fuelType: null,
});

const fuelBootstrap = (code: 'HSD' | 'PMG', qty: number) => ({
  id: `b-${code}`,
  branchId,
  productId: null,
  fuelTypeId: `ft-${code}`,
  asOfDate: new Date('2026-01-01T00:00:00Z'),
  quantity: qty as any,
  source: 'bootstrap_2026-01-01',
  product: null,
  fuelType: { code },
});

const receiptForProduct = (productIdLocal: string, qty: number) => ({
  purchaseOrder: {
    items: [{ quantityReceived: qty as any, product: { id: productIdLocal }, fuelType: null }],
  },
});

const poForProduct = (productIdLocal: string, qty: number) => ({
  status: 'received',
  stockReceipts: [],
  items: [{ quantityReceived: qty as any, product: { id: productIdLocal }, fuelType: null }],
});

const fuelReceipt = (code: 'HSD' | 'PMG', qty: number) => ({
  purchaseOrder: {
    items: [{ quantityReceived: qty as any, product: null, fuelType: { code } }],
  },
});

const saleForProduct = (productIdLocal: string, qty: number) => ({
  fuelSales: [],
  nonFuelSales: [{ productId: productIdLocal, quantity: qty }],
});

const saleForFuel = (code: 'HSD' | 'PMG', litres: number) => ({
  fuelSales: [{ quantityLiters: litres as any, fuelType: { code } }],
  nonFuelSales: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  // Defaults - every findMany returns []; individual tests override.
  (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.stockReceipt.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.monthlyInventoryGainLoss.findMany as jest.Mock).mockResolvedValue([]);
});

describe('computeInventoryOpeningClosing - accountant cycle', () => {
  it('returns empty map when no bootstrap rows exist for branch', async () => {
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-02-01',
      endDate: '2026-02-15',
    });
    expect(map.size).toBe(0);
  });

  it('opens at bootstrap value for the very first period (nothing prior)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(100)]);
    // Period: Jan 1 - Jan 31. No purchases/sales pre-period because bootstrap == period start.
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      // pre-window = []; period = [receipt 20 units]
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      return hasLt ? [] : [receiptForProduct(productId, 20)];
    });
    (prisma.sale.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.saleDate ?? {});
      return hasLt ? [] : [saleForProduct(productId, 5)];
    });

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    const row = map.get(`product:${productId}`);
    expect(row).toBeDefined();
    expect(row!.openingQty).toBe(100);
    expect(row!.purchasesQtyInPeriod).toBe(20);
    expect(row!.soldQtyInPeriod).toBe(5);
    expect(row!.closingQty).toBe(100 + 20 - 5);
  });

  it('rolls Jan closing forward as Feb opening (cycle continuity)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(100)]);
    // Pre-window = Jan activity, period = Feb 1-15.
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      // Jan: purchased 20
      // Feb: purchased 0
      return hasLt ? [receiptForProduct(productId, 20)] : [];
    });
    (prisma.sale.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.saleDate ?? {});
      // Jan: sold 5
      // Feb: sold 10
      return hasLt ? [saleForProduct(productId, 5)] : [saleForProduct(productId, 10)];
    });

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-02-01',
      endDate: '2026-02-15',
    });
    const row = map.get(`product:${productId}`)!;
    // Feb opening = Jan closing = 100 + 20 - 5 = 115
    expect(row.openingQty).toBe(115);
    expect(row.purchasesQtyInPeriod).toBe(0);
    expect(row.soldQtyInPeriod).toBe(10);
    expect(row.closingQty).toBe(115 - 10);
  });

  it('handles partial ranges mid-month (15-day window)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(50)]);
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      // Pre-window (Jan 1 -> Feb 10): purchased 30 total
      // In-window (Feb 10 -> Feb 24): purchased 5
      return hasLt ? [receiptForProduct(productId, 30)] : [receiptForProduct(productId, 5)];
    });
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-02-10',
      endDate: '2026-02-24',
    });
    const row = map.get(`product:${productId}`)!;
    // Opening = 50 + 30 - 0 = 80; closing = 80 + 5 - 0 = 85
    expect(row.openingQty).toBe(80);
    expect(row.purchasesQtyInPeriod).toBe(5);
    expect(row.closingQty).toBe(85);
  });

  it('folds fuel gain/loss into the correct month bucket', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([fuelBootstrap('HSD', 1000)]);
    // No purchases / sales
    (prisma.monthlyInventoryGainLoss.findMany as jest.Mock).mockResolvedValue([
      // Jan gain/loss -> counts toward Feb opening.
      { month: '2026-01', quantity: -20 as any, fuelType: { code: 'HSD' } },
      // Feb gain/loss -> in-period.
      { month: '2026-02', quantity: 15 as any, fuelType: { code: 'HSD' } },
    ]);

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
    const row = map.get('fuel:HSD')!;
    // Opening = 1000 + 0 - 0 + (-20) = 980
    expect(row.openingQty).toBe(980);
    expect(row.gainLossQtyInPeriod).toBe(15);
    // Closing = 980 + 0 - 0 + 15
    expect(row.closingQty).toBe(995);
  });

  it('keys fuel by fuel code, not by UUID (matches productMovement row shape)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      fuelBootstrap('HSD', 500),
      fuelBootstrap('PMG', 200),
    ]);
    (prisma.sale.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.saleDate ?? {});
      return hasLt ? [] : [saleForFuel('HSD', 100), saleForFuel('PMG', 40)];
    });
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(map.get('fuel:HSD')!.closingQty).toBe(400);
    expect(map.get('fuel:PMG')!.closingQty).toBe(160);
  });

  it('splits purchase vs PO-only to avoid double counting', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(0)]);
    // Same qty appears as both a stock receipt AND a PO - but the PO has a
    // stockReceipt so it must be filtered out by the helper.
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      return hasLt ? [] : [receiptForProduct(productId, 10)];
    });
    (prisma.purchaseOrder.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in ((where?.OR?.[0]?.receivedDate as any) ?? {});
      return hasLt
        ? []
        : [{ ...poForProduct(productId, 10), stockReceipts: [{ id: 'sr1' }] }];
    });

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    // Must be 10 (from receipt only) - NOT 20 (would double count PO).
    expect(map.get(`product:${productId}`)!.purchasesQtyInPeriod).toBe(10);
  });
});
