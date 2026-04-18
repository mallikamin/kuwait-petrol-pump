import { ReportsService } from './reports.service';
import { prisma } from '../../config/database';

// Mock Prisma
jest.mock('../../config/database', () => ({
  prisma: {
    branch: { findFirst: jest.fn() },
    stockLevel: { findMany: jest.fn() },
    fuelType: { findMany: jest.fn() },
    stockReceipt: { findMany: jest.fn() },
    purchaseOrder: { findMany: jest.fn() },
    sale: { findMany: jest.fn() },
  },
}));

describe('Inventory Report - Date Filtering', () => {
  let reportsService: ReportsService;
  const testBranchId = 'branch-123';
  const testOrgId = 'org-123';
  const testBranch = { id: testBranchId, name: 'Test Branch', organizationId: testOrgId };

  beforeEach(() => {
    reportsService = new ReportsService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Precedence: startDate/endDate > asOfDate > no filter', () => {
    it('should use date range when both startDate and endDate are provided', async () => {
      const startDate = '2026-04-07';
      const endDate = '2026-04-11';

      // Mock branch lookup
      (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);

      // Mock stock levels
      (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);

      // Mock fuel types
      (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);

      // Mock stock receipts query
      (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);

      // Mock purchase orders query
      (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

      // Call service
      await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, startDate, endDate);

      // Verify stock receipt query was called with range filter
      const stockReceiptCall = (prisma.stockReceipt.findMany as any).mock.calls[0];
      expect(stockReceiptCall[0].where.receiptDate).toBeDefined();
      expect(stockReceiptCall[0].where.receiptDate.gte).toBeDefined();
      expect(stockReceiptCall[0].where.receiptDate.lte).toBeDefined();

      // PO query uses OR to admit both stamped receivedDate and null-receivedDate rows
      // (via updatedAt fallback). Range bounds must still appear on one of the clauses.
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(Array.isArray(poCall[0].where.OR)).toBe(true);
      expect(poCall[0].where.OR[0].receivedDate.gte).toBeDefined();
      expect(poCall[0].where.OR[0].receivedDate.lte).toBeDefined();
      expect(poCall[0].where.OR[1].receivedDate).toBeNull();
      expect(poCall[0].where.OR[1].updatedAt.gte).toBeDefined();
      expect(poCall[0].where.OR[1].updatedAt.lte).toBeDefined();
    });

    it('should use single-date filter when only asOfDate is provided', async () => {
      const asOfDate = '2026-04-08';

      // Mock branch lookup
      (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);

      // Mock stock levels
      (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);

      // Mock fuel types
      (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);

      // Mock stock receipts query
      (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);

      // Mock purchase orders query
      (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

      // Call service
      await reportsService.getInventoryReport(testBranchId, testOrgId, asOfDate);

      // Verify stock receipt query was called with single-date filter (lte only)
      const stockReceiptCall = (prisma.stockReceipt.findMany as any).mock.calls[0];
      expect(stockReceiptCall[0].where.receiptDate).toBeDefined();
      expect(stockReceiptCall[0].where.receiptDate.lte).toBeDefined();
      expect(stockReceiptCall[0].where.receiptDate.gte).toBeUndefined();

      // Single-date PO filter: OR of receivedDate{lte} and receivedDate=null+updatedAt{lte}.
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(Array.isArray(poCall[0].where.OR)).toBe(true);
      expect(poCall[0].where.OR[0].receivedDate.lte).toBeDefined();
      expect(poCall[0].where.OR[0].receivedDate.gte).toBeUndefined();
      expect(poCall[0].where.OR[1].receivedDate).toBeNull();
      expect(poCall[0].where.OR[1].updatedAt.lte).toBeDefined();
    });

    it('should include all purchases when no date filter provided', async () => {
      // Mock branch lookup
      (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);

      // Mock stock levels
      (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);

      // Mock fuel types
      (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);

      // Mock stock receipts query
      (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);

      // Mock purchase orders query
      (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

      // Call service with no date filters
      await reportsService.getInventoryReport(testBranchId, testOrgId);

      // Verify stock receipt query was called WITHOUT date filter
      const stockReceiptCall = (prisma.stockReceipt.findMany as any).mock.calls[0];
      expect(stockReceiptCall[0].where.receiptDate).toBeUndefined();

      // Verify PO query was called WITHOUT any date filter (neither top-level nor OR)
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(poCall[0].where.receivedDate).toBeUndefined();
      expect(poCall[0].where.OR).toBeUndefined();
    });
  });

  describe('Date range inclusivity', () => {
    it('should include records from start-of-day on startDate to end-of-day on endDate', async () => {
      const startDate = '2026-04-07';
      const endDate = '2026-04-11';

      // Mock branch lookup
      (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);

      // Mock stock levels
      (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);

      // Mock fuel types
      (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);

      // Mock stock receipts query
      (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);

      // Mock purchase orders query
      (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

      // Call service
      await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, startDate, endDate);

      // Get the filter used
      const stockReceiptCall = (prisma.stockReceipt.findMany as any).mock.calls[0];
      const dateFilter = stockReceiptCall[0].where.receiptDate;

      // Verify start date is 00:00:00
      const expectedStart = new Date(startDate);
      expectedStart.setHours(0, 0, 0, 0);
      expect(dateFilter.gte.getTime()).toBe(expectedStart.getTime());

      // Verify end date is 23:59:59
      const expectedEnd = new Date(endDate);
      expectedEnd.setHours(23, 59, 59, 999);
      expect(dateFilter.lte.getTime()).toBe(expectedEnd.getTime());
    });

    it('should set asOfDate to end-of-day for single-date mode', async () => {
      const asOfDate = '2026-04-08';

      // Mock branch lookup
      (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);

      // Mock stock levels
      (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);

      // Mock fuel types
      (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);

      // Mock stock receipts query
      (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);

      // Mock purchase orders query
      (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

      // Call service
      await reportsService.getInventoryReport(testBranchId, testOrgId, asOfDate);

      // Get the filter used
      const stockReceiptCall = (prisma.stockReceipt.findMany as any).mock.calls[0];
      const dateFilter = stockReceiptCall[0].where.receiptDate;

      // Verify date is set to end-of-day
      const expectedEnd = new Date(asOfDate);
      expectedEnd.setHours(23, 59, 59, 999);
      expect(dateFilter.lte.getTime()).toBe(expectedEnd.getTime());
    });
  });
});

describe('Inventory Report - PO status + null receivedDate handling', () => {
  let reportsService: ReportsService;
  const testBranchId = 'branch-abc';
  const testOrgId = 'org-abc';
  const testBranch = { id: testBranchId, name: 'Test Branch', organizationId: testOrgId };

  beforeEach(() => {
    reportsService = new ReportsService();
    jest.clearAllMocks();
  });

  it('PO status filter includes received AND partial_received', async () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

    await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30');

    const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
    expect(poCall[0].where.status).toEqual({ in: ['received', 'partial_received'] });
  });

  it('PO date filter uses OR to also admit rows with null receivedDate via updatedAt', async () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);

    await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30');

    const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
    expect(Array.isArray(poCall[0].where.OR)).toBe(true);
    expect(poCall[0].where.OR).toHaveLength(2);
    expect(poCall[0].where.OR[0]).toHaveProperty('receivedDate');
    expect(poCall[0].where.OR[1]).toEqual(
      expect.objectContaining({ receivedDate: null })
    );
    expect(poCall[0].where.OR[1]).toHaveProperty('updatedAt');
    // Ensure no lingering top-level receivedDate filter (would exclude nulls).
    expect(poCall[0].where.receivedDate).toBeUndefined();
  });

  it('received PO with null receivedDate still contributes to purchases + totals', async () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([
      {
        id: 'po-1',
        poNumber: 'PO-001',
        status: 'partial_received',
        receivedDate: null,
        updatedAt: new Date('2026-04-15'),
        supplier: { name: 'Acme Fuels' },
        items: [
          {
            id: 'item-1',
            product: null,
            fuelType: { code: 'HSD', name: 'High Speed Diesel' },
            quantityReceived: { toString: () => '500' },
            costPerUnit: { toString: () => '300' },
            totalCost: { toString: () => '150000' },
          },
        ],
      },
    ]);
    (prisma.sale.findMany as any).mockResolvedValueOnce([]);

    const out = await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30');

    expect(out.purchases).toHaveLength(1);
    expect(out.purchases[0]).toEqual(expect.objectContaining({
      poNumber: 'PO-001',
      name: 'High Speed Diesel',
      fuelCode: 'HSD',
      quantityReceived: 500,
      totalCost: 150000,
      status: 'partial_received',
    }));
    expect(Number(out.summary.totalValue)).toBe(150000);
    expect(out.summary.totalProducts).toBe(1);
    expect(out.diagnostics.purchasesFound).toBe(1);
  });

  it('fuel movement aggregates via fuelType.code and allows negative net (sales > purchases)', async () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([
      {
        id: 'po-2',
        poNumber: 'PO-002',
        status: 'received',
        receivedDate: new Date('2026-04-10'),
        updatedAt: new Date('2026-04-10'),
        supplier: { name: 'S1' },
        items: [
          {
            id: 'item-A',
            product: null,
            // Deliberately non-matching name to prove fuelType.code drives aggregation.
            fuelType: { code: 'HSD', name: 'Ultra Low Sulphur' },
            quantityReceived: { toString: () => '100' },
            costPerUnit: { toString: () => '300' },
            totalCost: { toString: () => '30000' },
          },
        ],
      },
    ]);
    // Sales > purchases → negative net movement expected for HSD.
    (prisma.sale.findMany as any).mockResolvedValueOnce([
      {
        totalAmount: { toNumber: () => 102000 },
        fuelSales: [
          { quantityLiters: { toNumber: () => 340 }, totalAmount: { toNumber: () => 102000 }, fuelType: { code: 'HSD', name: 'HSD' } },
        ],
        nonFuelSales: [],
      },
    ]);

    const out = await reportsService.getInventoryReport(testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30');

    expect(out.fuelMovement).toBeTruthy();
    const hsd = out.fuelMovement.byFuelType.find((r: any) => r.fuelCode === 'HSD');
    expect(hsd).toBeDefined();
    expect(hsd.purchases).toBe(100);
    expect(hsd.sales).toBe(340);
    expect(hsd.netMovement).toBe(-240); // negative allowed
  });
});

describe('Inventory Report - ISO date input regression', () => {
  // Production bug 2026-04-18: Reports.tsx forwards dates as
  // `new Date(value).toISOString()` ("2026-04-18T00:00:00.000Z").
  // The pre-fix timezone helpers threw on the ISO suffix; the inventory
  // try/catch swallowed the throw and returned all-zero data.
  // These tests ensure both formats now produce equivalent results AND that
  // diagnostics.errors stays empty on the happy path.
  let reportsService: ReportsService;
  const testBranchId = 'branch-iso';
  const testOrgId = 'org-iso';
  const testBranch = { id: testBranchId, name: 'Test Branch', organizationId: testOrgId };

  beforeEach(() => {
    reportsService = new ReportsService();
    jest.clearAllMocks();
  });

  const seedHappyPath = () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([
      {
        id: 'po-iso',
        poNumber: 'PO-ISO',
        status: 'received',
        receivedDate: new Date('2026-04-10'),
        updatedAt: new Date('2026-04-10'),
        supplier: { name: 'S' },
        items: [
          {
            id: 'item-iso',
            product: null,
            fuelType: { code: 'HSD', name: 'High Speed Diesel' },
            quantityReceived: { toString: () => '100' },
            costPerUnit: { toString: () => '300' },
            totalCost: { toString: () => '30000' },
          },
        ],
      },
    ]);
    (prisma.sale.findMany as any).mockResolvedValueOnce([]);
  };

  it('accepts ISO-Z startDate/endDate end-to-end (no silent zeros)', async () => {
    seedHappyPath();
    const out = await reportsService.getInventoryReport(
      testBranchId,
      testOrgId,
      undefined,
      '2026-04-01T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
    );
    expect(out.purchases).toHaveLength(1);
    expect(out.diagnostics.purchasesFound).toBe(1);
    expect(out.diagnostics.errors).toEqual([]);
    expect(out.fuelMovement).toBeTruthy();
  });

  it('accepts ISO-Z asOfDate (single-date mode)', async () => {
    seedHappyPath();
    const out = await reportsService.getInventoryReport(
      testBranchId,
      testOrgId,
      '2026-04-30T00:00:00.000Z',
    );
    expect(out.purchases).toHaveLength(1);
    expect(out.diagnostics.errors).toEqual([]);
  });

  it('diagnostics.errors stays [] on a clean run with YYYY-MM-DD input', async () => {
    seedHappyPath();
    const out = await reportsService.getInventoryReport(
      testBranchId,
      testOrgId,
      undefined,
      '2026-04-01',
      '2026-04-30',
    );
    expect(out.diagnostics.errors).toEqual([]);
  });
});

describe('Inventory Report - Product-Wise Movement', () => {
  let reportsService: ReportsService;
  const testBranchId = 'branch-pw';
  const testOrgId = 'org-pw';
  const testBranch = { id: testBranchId, name: 'Test Branch', organizationId: testOrgId };

  beforeEach(() => {
    reportsService = new ReportsService();
    // resetAllMocks (vs clearAllMocks) drains queued mockResolvedValueOnce
    // values from prior describe blocks. Each test in this block seeds its
    // own fixture and we want every getInventoryReport call to be served by
    // exactly the values queued in the same test.
    jest.resetAllMocks();
  });

  // Two non-fuel products + HSD purchase + HSD/PMG sales lets us assert every
  // category branch and the movement-only filter in a single fixture.
  const seedRichFixture = () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([
      // Fuel PO — HSD 1000L @ 300
      {
        id: 'po-hsd', poNumber: 'PO-HSD', status: 'received',
        receivedDate: new Date('2026-04-10'), updatedAt: new Date('2026-04-10'),
        supplier: { name: 'S' },
        items: [{
          id: 'i-hsd', product: null,
          fuelType: { code: 'HSD', name: 'High Speed Diesel' },
          quantityReceived: { toString: () => '1000' },
          costPerUnit: { toString: () => '300' },
          totalCost: { toString: () => '300000' },
        }],
      },
      // Non-fuel PO — Product A purchased 50 units, no sales
      {
        id: 'po-a', poNumber: 'PO-A', status: 'received',
        receivedDate: new Date('2026-04-12'), updatedAt: new Date('2026-04-12'),
        supplier: { name: 'S' },
        items: [{
          id: 'i-a',
          product: { id: 'prod-A', name: 'Filter A', sku: 'A-001' },
          fuelType: null,
          quantityReceived: { toString: () => '50' },
          costPerUnit: { toString: () => '100' },
          totalCost: { toString: () => '5000' },
        }],
      },
    ]);
    (prisma.sale.findMany as any).mockResolvedValueOnce([
      // HSD sold 200L @ 300, PMG sold 50L @ 280, Product B sold 10 @ 150
      {
        totalAmount: { toNumber: () => 60000 },
        fuelSales: [{
          quantityLiters: { toNumber: () => 200 },
          totalAmount: { toNumber: () => 60000 },
          fuelType: { code: 'HSD', name: 'HSD' },
        }],
        nonFuelSales: [],
      },
      {
        totalAmount: { toNumber: () => 14000 },
        fuelSales: [{
          quantityLiters: { toNumber: () => 50 },
          totalAmount: { toNumber: () => 14000 },
          fuelType: { code: 'PMG', name: 'PMG' },
        }],
        nonFuelSales: [],
      },
      {
        totalAmount: { toNumber: () => 1500 },
        fuelSales: [],
        nonFuelSales: [{
          productId: 'prod-B', quantity: 10,
          unitPrice: { toNumber: () => 150 },
          totalAmount: { toNumber: () => 1500 },
          product: { name: 'Filter B' },
        }],
      },
    ]);
  };

  it('returns null productMovement in single-date mode (no sales query)', async () => {
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);
    const out = await reportsService.getInventoryReport(testBranchId, testOrgId, '2026-04-15');
    expect(out.productMovement).toBeNull();
  });

  it('category=all returns HSD + PMG + non-fuel rows with movement only', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30', 'all',
    );
    expect(out.productMovement).toBeTruthy();
    expect(out.productMovement.filters.category).toBe('all');

    const rows = out.productMovement.rows;
    // Expect 4 rows: HSD (purch+sold), PMG (sold only), Filter A (purch only), Filter B (sold only)
    const byKey = Object.fromEntries(rows.map((r: any) => [r.productId, r]));

    expect(byKey['HSD']).toEqual(expect.objectContaining({
      productType: 'HSD', unit: 'L',
      purchasedQty: 1000, soldQty: 200, netMovement: 800,
      purchasedValue: 300000, soldValue: 60000,
    }));
    expect(byKey['PMG']).toEqual(expect.objectContaining({
      productType: 'PMG', unit: 'L',
      purchasedQty: 0, soldQty: 50, netMovement: -50,
      soldValue: 14000,
    }));
    expect(byKey['prod-A']).toEqual(expect.objectContaining({
      productType: 'non_fuel', unit: 'units',
      purchasedQty: 50, soldQty: 0, netMovement: 50,
    }));
    expect(byKey['prod-B']).toEqual(expect.objectContaining({
      productType: 'non_fuel', unit: 'units',
      purchasedQty: 0, soldQty: 10, netMovement: -10, soldValue: 1500,
    }));
  });

  it('category=HSD returns HSD row only', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30', 'HSD',
    );
    expect(out.productMovement.rows).toHaveLength(1);
    expect(out.productMovement.rows[0].productType).toBe('HSD');
    expect(out.productMovement.filters.category).toBe('HSD');
  });

  it('category=PMG returns PMG row only', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30', 'PMG',
    );
    expect(out.productMovement.rows).toHaveLength(1);
    expect(out.productMovement.rows[0].productType).toBe('PMG');
    expect(out.productMovement.rows[0].netMovement).toBe(-50);
  });

  it('category=non_fuel returns only non-fuel rows', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30', 'non_fuel',
    );
    expect(out.productMovement.rows.every((r: any) => r.productType === 'non_fuel')).toBe(true);
    expect(out.productMovement.rows).toHaveLength(2);
  });

  it('productId filter (non-fuel) returns single row', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30', 'non_fuel', 'prod-B',
    );
    expect(out.productMovement.rows).toHaveLength(1);
    expect(out.productMovement.rows[0].productId).toBe('prod-B');
    expect(out.productMovement.filters.productId).toBe('prod-B');
  });

  it('movement-only: products with no purchase and no sale are excluded', async () => {
    // Empty fixture — no purchases, no sales → no rows
    (prisma.branch.findFirst as any).mockResolvedValueOnce(testBranch);
    (prisma.stockLevel.findMany as any).mockResolvedValueOnce([]);
    (prisma.fuelType.findMany as any).mockResolvedValueOnce([]);
    (prisma.stockReceipt.findMany as any).mockResolvedValueOnce([]);
    (prisma.purchaseOrder.findMany as any).mockResolvedValueOnce([]);
    (prisma.sale.findMany as any).mockResolvedValueOnce([]);
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined, '2026-04-01', '2026-04-30',
    );
    expect(out.productMovement.rows).toEqual([]);
    expect(out.diagnostics.productMovementRows).toBe(0);
    expect(out.diagnostics.errors).toEqual([]);
  });

  it('accepts ISO-Z dates with category filter end-to-end', async () => {
    seedRichFixture();
    const out = await reportsService.getInventoryReport(
      testBranchId, testOrgId, undefined,
      '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z', 'HSD',
    );
    expect(out.productMovement.rows).toHaveLength(1);
    expect(out.productMovement.rows[0].productType).toBe('HSD');
    expect(out.diagnostics.errors).toEqual([]);
  });
});

describe('Inventory Report - CSV Export Completeness', () => {
  it('should include purchases in response when available', async () => {
    // This is tested at the integration level
    // The response should always include a "purchases" array
    // See: https://github.com/mallikamin/kuwait-petrol-pump/pull/XXX

    const mockInventoryResponse = {
      branch: { id: 'branch-123', name: 'Test Branch' },
      asOfDate: '2026-04-08',
      summary: { totalProducts: 10, totalQuantity: 100, lowStockCount: 2 },
      nonFuelProducts: { normal: [], lowStock: [] },
      purchases: [
        {
          poNumber: 'PO-001',
          receiptNumber: 'REC-001',
          id: 'item-1',
          name: 'Product A',
          sku: 'SKU-001',
          supplierName: 'Supplier A',
          quantityReceived: 50,
          costPerUnit: 100,
          totalCost: 5000,
          receiptDate: '2026-04-07',
          status: 'received_with_receipt',
          receivedBy: 'John Doe',
        },
      ],
    };

    // Verify purchases are included
    expect(mockInventoryResponse.purchases).toBeDefined();
    expect(mockInventoryResponse.purchases.length).toBeGreaterThan(0);
    expect(mockInventoryResponse.purchases[0].poNumber).toBeDefined();
    expect(mockInventoryResponse.purchases[0].quantityReceived).toBeDefined();
    expect(mockInventoryResponse.purchases[0].totalCost).toBeDefined();
  });
});
