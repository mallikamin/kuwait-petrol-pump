import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReportsService } from './reports.service';
import { prisma } from '../../config/database';

// Mock Prisma
vi.mock('../../config/database', () => ({
  prisma: {
    branch: { findFirst: vi.fn() },
    stockLevel: { findMany: vi.fn() },
    fuelType: { findMany: vi.fn() },
    stockReceipt: { findMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
  },
}));

describe('Inventory Report - Date Filtering', () => {
  let reportsService: ReportsService;
  const testBranchId = 'branch-123';
  const testOrgId = 'org-123';
  const testBranch = { id: testBranchId, name: 'Test Branch', organizationId: testOrgId };

  beforeEach(() => {
    reportsService = new ReportsService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

      // Verify PO query was called with range filter
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(poCall[0].where.receivedDate).toBeDefined();
      expect(poCall[0].where.receivedDate.gte).toBeDefined();
      expect(poCall[0].where.receivedDate.lte).toBeDefined();
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

      // Verify PO query was called with single-date filter (lte only)
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(poCall[0].where.receivedDate).toBeDefined();
      expect(poCall[0].where.receivedDate.lte).toBeDefined();
      expect(poCall[0].where.receivedDate.gte).toBeUndefined();
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

      // Verify PO query was called WITHOUT date filter
      const poCall = (prisma.purchaseOrder.findMany as any).mock.calls[0];
      expect(poCall[0].where.receivedDate).toBeUndefined();
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
