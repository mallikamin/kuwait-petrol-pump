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

// Legacy-shape fixture: receipt with NO StockReceiptItem rows. The service
// falls back to the PO item's cumulative quantity (once per PO) for these.
const receiptForProduct = (productIdLocal: string, qty: number, opts?: { id?: string; purchaseOrderId?: string }) => ({
  id: opts?.id || `r-${productIdLocal}-${qty}`,
  purchaseOrderId: opts?.purchaseOrderId || `po-${productIdLocal}`,
  items: [],
  purchaseOrder: {
    items: [{ id: `poi-${productIdLocal}`, quantityReceived: qty as any, product: { id: productIdLocal }, fuelType: null }],
  },
});

// Authoritative-shape fixture: receipt carrying real StockReceiptItem rows.
// The service must prefer these per-receipt quantities over the PO cumulative.
const receiptWithItems = (
  productIdLocal: string,
  poQuantityReceived: number,
  sriQty: number,
  opts?: { id?: string; purchaseOrderId?: string; poItemId?: string },
) => ({
  id: opts?.id || `r-${productIdLocal}-${sriQty}`,
  purchaseOrderId: opts?.purchaseOrderId || `po-${productIdLocal}`,
  items: [{ poItemId: opts?.poItemId || `poi-${productIdLocal}`, quantityReceived: sriQty as any }],
  purchaseOrder: {
    items: [{ id: opts?.poItemId || `poi-${productIdLocal}`, quantityReceived: poQuantityReceived as any, product: { id: productIdLocal }, fuelType: null }],
  },
});

const fuelReceiptWithItems = (
  code: 'HSD' | 'PMG',
  poQuantityReceived: number,
  sriQty: number,
  opts?: { id?: string; purchaseOrderId?: string; poItemId?: string },
) => ({
  id: opts?.id || `r-${code}-${sriQty}`,
  purchaseOrderId: opts?.purchaseOrderId || `po-${code}`,
  items: [{ poItemId: opts?.poItemId || `poi-${code}`, quantityReceived: sriQty as any }],
  purchaseOrder: {
    items: [{ id: opts?.poItemId || `poi-${code}`, quantityReceived: poQuantityReceived as any, product: null, fuelType: { code } }],
  },
});

const poForProduct = (productIdLocal: string, qty: number, opts?: { id?: string }) => ({
  id: opts?.id || `po-${productIdLocal}`,
  status: 'received',
  stockReceipts: [],
  items: [{ id: `poi-${productIdLocal}`, quantityReceived: qty as any, product: { id: productIdLocal }, fuelType: null }],
});

const fuelReceipt = (code: 'HSD' | 'PMG', qty: number) => ({
  id: `r-${code}-${qty}`,
  purchaseOrderId: `po-${code}`,
  items: [],
  purchaseOrder: {
    items: [{ id: `poi-${code}`, quantityReceived: qty as any, product: null, fuelType: { code } }],
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

  it('accepts a bootstrap stored as DATE (midnight UTC) even when period_start is ahead of UTC', async () => {
    // Regression: asOfDate stored as midnight UTC 2026-01-01 was being
    // excluded by `asOfDate <= toBranchStartOfDay(startDate)` because
    // Karachi's start-of-day is the previous day 19:00 UTC. Verify that
    // the calendar-day cutoff used in the service now includes it.
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const cutoff = where?.asOfDate?.lte as Date | undefined;
      const dateIso = new Date('2026-01-01T00:00:00.000Z');
      // Accept the row if cutoff is strictly after midnight UTC on 2026-01-01.
      if (cutoff && cutoff.getTime() >= dateIso.getTime()) {
        return [bootstrap(50, dateIso)];
      }
      return [];
    });

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(map.size).toBe(1);
    expect(map.get(`product:${productId}`)!.openingQty).toBe(50);
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

  // Scenario 1: Dec-31 pre-window purchase + Jan-2 in-period purchase, range
  // Jan 1-Jan 4. Opening must include ONLY the Dec-31 receipt; in-period
  // purchases must include ONLY Jan-2. The regression this guards against is
  // a Dec-31 receipt being mis-attributed to the in-period bucket (or being
  // multiplied when the PO has >1 receipt).
  it('Scenario 1: Dec-31 pre-window receipt feeds opening, Jan-2 feeds in-period', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      bootstrap(0, new Date('2026-01-01T00:00:00Z')),
    ]);
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      return hasLt
        ? [receiptWithItems(productId, 10000, 10000, { id: 'r-dec31', purchaseOrderId: 'po-dec31', poItemId: 'poi-dec31' })]
        : [receiptWithItems(productId, 5000, 5000, { id: 'r-jan2', purchaseOrderId: 'po-jan2', poItemId: 'poi-jan2' })];
    });
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-04',
    });
    const row = map.get(`product:${productId}`)!;
    expect(row.openingQty).toBe(10000);
    expect(row.purchasesQtyInPeriod).toBe(5000);
    expect(row.closingQty).toBe(15000);
  });

  // Scenario 2: Opening-Stock editor saves a bootstrap on Jan-1; the opening
  // cycle must pick it up and apply it at movement opening — not zero-out.
  it('Scenario 2: bootstrap saved on Jan-1 is the opening for a Jan-1..Jan-4 range', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      bootstrap(7777, new Date('2026-01-01T00:00:00Z')),
    ]);
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-04',
    });
    expect(map.get(`product:${productId}`)!.openingQty).toBe(7777);
  });

  // Scenario 3: Continuity — opening(next range) must equal closing(prev range).
  it('Scenario 3: opening(Jan 5-10) equals closing(Jan 1-4) for same item', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(100)]);
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const gte = (where?.receiptDate?.gte as Date | undefined);
      const lt = (where?.receiptDate?.lt as Date | undefined);
      const lte = (where?.receiptDate?.lte as Date | undefined);
      // Single Jan-2 receipt of 50 units. It belongs to Jan 1-4 in-period,
      // and to Jan 5-10's pre-window (i.e., Jan 5-10 opening should include it).
      const jan2 = new Date('2026-01-02T05:00:00.000Z');
      const withinGte = !gte || jan2 >= gte;
      const withinLt = lt ? jan2 < lt : true;
      const withinLte = lte ? jan2 <= lte : true;
      if (withinGte && withinLt && withinLte) {
        return [receiptWithItems(productId, 50, 50, { id: 'r-jan2', purchaseOrderId: 'po-jan2', poItemId: 'poi-jan2' })];
      }
      return [];
    });
    (prisma.sale.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const gte = (where?.saleDate?.gte as Date | undefined);
      const lt = (where?.saleDate?.lt as Date | undefined);
      const lte = (where?.saleDate?.lte as Date | undefined);
      // Jan-3 sale of 20 units.
      const jan3 = new Date('2026-01-03T05:00:00.000Z');
      const withinGte = !gte || jan3 >= gte;
      const withinLt = lt ? jan3 < lt : true;
      const withinLte = lte ? jan3 <= lte : true;
      if (withinGte && withinLt && withinLte) return [saleForProduct(productId, 20)];
      return [];
    });

    const jan14 = await computeInventoryOpeningClosing({
      branchId, startDate: '2026-01-01', endDate: '2026-01-04',
    });
    const jan510 = await computeInventoryOpeningClosing({
      branchId, startDate: '2026-01-05', endDate: '2026-01-10',
    });
    const prev = jan14.get(`product:${productId}`)!;
    const next = jan510.get(`product:${productId}`)!;
    expect(next.openingQty).toBe(prev.closingQty);
    // And the concrete numbers: 100 + 50 - 20 = 130
    expect(prev.closingQty).toBe(130);
  });

  // Scenario 4: A PO has 2 StockReceipts on the same item (split delivery).
  // Bug was: PO item quantityReceived (cumulative = 10000) was added once per
  // receipt ⇒ 20000. Fix: use StockReceiptItem.quantityReceived (5000 each).
  it('Scenario 4: multi-receipt PO is not double-counted', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([bootstrap(0)]);
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      if (hasLt) return [];
      // Same PO, same item, two receipts — each delivered 5000 of the
      // cumulative 10000 quantityReceived recorded on PurchaseOrderItem.
      return [
        receiptWithItems(productId, 10000, 5000, { id: 'r1', purchaseOrderId: 'po-multi', poItemId: 'poi-multi' }),
        receiptWithItems(productId, 10000, 5000, { id: 'r2', purchaseOrderId: 'po-multi', poItemId: 'poi-multi' }),
      ];
    });
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    // Must be 10000 — NOT 20000 (pre-fix bug) and NOT 15000.
    expect(map.get(`product:${productId}`)!.purchasesQtyInPeriod).toBe(10000);
  });

  // Scenario 4b (fuel): the same bug guarded for HSD so the real-world
  // "Jan 1-4 showed 20k when only 10k was bought" reproducer has an explicit
  // regression test on the fuel path too.
  it('Scenario 4b (fuel): multi-receipt HSD PO is not double-counted', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([fuelBootstrap('HSD', 0)]);
    (prisma.stockReceipt.findMany as jest.Mock).mockImplementation(async ({ where }: any) => {
      const hasLt = 'lt' in (where?.receiptDate ?? {});
      if (hasLt) return [];
      return [
        fuelReceiptWithItems('HSD', 10000, 5000, { id: 'rH1', purchaseOrderId: 'po-hsd-multi', poItemId: 'poi-hsd' }),
        fuelReceiptWithItems('HSD', 10000, 5000, { id: 'rH2', purchaseOrderId: 'po-hsd-multi', poItemId: 'poi-hsd' }),
      ];
    });
    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01',
      endDate: '2026-01-04',
    });
    expect(map.get('fuel:HSD')!.purchasesQtyInPeriod).toBe(10000);
  });

  // Regression: the frontend sends `new Date(startDate).toISOString()`,
  // which produces 'YYYY-MM-DDTHH:mm:ss.sssZ'. Naïvely concatenating
  // `${startDate}T23:59:59.999Z` for the bootstrap cutoff used to give
  // 'Invalid Date', which made Prisma throw, the outer try/catch zeroed
  // every row, and the user saw HSD opening=0 + gain/loss=0 even when
  // bootstrap=10000 and 6 gain/loss rows existed.
  it('accepts ISO-Z startDate/endDate (full ISO from `new Date().toISOString()`)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      fuelBootstrap('HSD', 10000),
    ]);
    (prisma.stockReceipt.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.purchaseOrder.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.monthlyInventoryGainLoss.findMany as jest.Mock).mockResolvedValue([
      { id: 'gl1', branchId, fuelTypeId: 'ft-HSD', month: '2026-02', quantity: 300 as any, fuelType: { code: 'HSD' } },
      { id: 'gl2', branchId, fuelTypeId: 'ft-HSD', month: '2026-03', quantity: 500 as any, fuelType: { code: 'HSD' } },
    ]);

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-04-25T00:00:00.000Z',
    });

    const hsd = map.get('fuel:HSD');
    expect(hsd).toBeDefined();
    expect(hsd!.openingQty).toBe(10000);                  // bootstrap honoured, not zeroed
    expect(hsd!.gainLossQtyInPeriod).toBe(800);           // 300 + 500 in period (>= 2026-01)
    expect(hsd!.closingQty).toBe(10800);                  // 10000 + 800
  });

  // Regression: same ISO-Z input but no bootstrap row exists. The fallback
  // path that surfaces gain/loss alone must also handle ISO-Z input.
  it('accepts ISO-Z input on the gain-loss-only fallback (no bootstrap)', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.monthlyInventoryGainLoss.findMany as jest.Mock).mockResolvedValue([
      { id: 'gl1', branchId, fuelTypeId: 'ft-HSD', month: '2026-02', quantity: 100 as any, fuelType: { code: 'HSD' } },
    ]);

    const map = await computeInventoryOpeningClosing({
      branchId,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-04-25T00:00:00.000Z',
    });

    expect(map.get('fuel:HSD')?.gainLossQtyInPeriod).toBe(100);
  });
});
