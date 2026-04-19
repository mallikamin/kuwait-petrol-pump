/**
 * Regression tests for the QB enqueue hook in sales.service.
 *
 * The hook fires AFTER prisma.sale.create — so if prisma.sale.create returns
 * successfully, a QBSyncQueue row must be created (create_sales_receipt for
 * cash, create_invoice for AR) with idempotencyKey=qb-sale-<saleId>.
 *
 * Enqueue failures must NOT throw — the sale is already persisted and the
 * caller is the POS controller, which can't roll back a successful sale just
 * because QB is unreachable.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SalesService } from './sales.service';

jest.mock('../../config/database', () => ({
  prisma: {
    branch: { findFirst: jest.fn() },
    nozzle: { findFirst: jest.fn() },
    customer: { findFirst: jest.fn() },
    sale: { create: jest.fn() },
    product: { findMany: jest.fn() },
    stockLevel: { updateMany: jest.fn() },
    qBConnection: { findFirst: jest.fn() },
    qBSyncQueue: { createMany: jest.fn() },
  },
}));

import { prisma } from '../../config/database';

const svc = new SalesService();
const orgId = 'org-1';
const branchId = 'branch-1';
const userId = 'user-1';

function resetMocks() {
  jest.clearAllMocks();
  (prisma.branch.findFirst as jest.MockedFunction<any>).mockResolvedValue({
    id: branchId, organizationId: orgId,
  } as any);
  (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue({
    id: 'qb-conn-1', organizationId: orgId, isActive: true,
  } as any);
  (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mockResolvedValue({ count: 1 } as any);
}

describe('SalesService.createFuelSale → QB enqueue', () => {
  beforeEach(resetMocks);

  it('cash fuel sale → create_sales_receipt with idempotencyKey and FuelSalePayload shape', async () => {
    (prisma.sale.create as jest.MockedFunction<any>).mockResolvedValue({
      id: 'sale-1',
      saleDate: new Date('2026-04-19T10:00:00Z'),
      customerId: null,
      bankId: null,
      fuelSales: [{ fuelType: { name: 'HSD' } }],
    } as any);

    await svc.createFuelSale({
      branchId,
      fuelTypeId: 'fuel-HSD',
      quantityLiters: 40,
      pricePerLiter: 260,
      paymentMethod: 'cash',
    } as any, userId, orgId);

    expect(prisma.qBSyncQueue.createMany).toHaveBeenCalledTimes(1);
    const args = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0] as any;
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(1);
    const row = args.data[0];
    expect(row.jobType).toBe('create_sales_receipt');
    expect(row.entityType).toBe('sale');
    expect(row.entityId).toBe('sale-1');
    expect(row.idempotencyKey).toBe('qb-sale-sale-1');
    expect(row.payload.paymentMethod).toBe('cash');
    expect(row.payload.lineItems).toHaveLength(1);
    expect(row.payload.lineItems[0]).toEqual(expect.objectContaining({
      fuelTypeId: 'fuel-HSD', quantity: 40, unitPrice: 260, amount: 10400,
    }));
    expect(row.payload.totalAmount).toBe(10400);
    expect(row.payload.txnDate).toBe('2026-04-19');
  });

  it('credit fuel sale → create_invoice (credit_customer routes to AR)', async () => {
    (prisma.customer.findFirst as jest.MockedFunction<any>).mockResolvedValue({ id: 'c-1' });
    (prisma.sale.create as jest.MockedFunction<any>).mockResolvedValue({
      id: 'sale-2',
      saleDate: new Date('2026-04-19'),
      customerId: 'c-1',
      bankId: null,
      fuelSales: [{ fuelType: { name: 'PMG' } }],
    } as any);

    await svc.createFuelSale({
      branchId,
      fuelTypeId: 'fuel-PMG',
      quantityLiters: 20,
      pricePerLiter: 290.5,
      paymentMethod: 'credit',
      customerId: 'c-1',
    } as any, userId, orgId);

    const row = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0].data[0];
    expect(row.jobType).toBe('create_invoice');
    expect(row.payload.customerId).toBe('c-1');
  });

  it('no QB connection → silently skips enqueue (sale still persists)', async () => {
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(null);
    (prisma.sale.create as jest.MockedFunction<any>).mockResolvedValue({
      id: 'sale-3', saleDate: new Date(), customerId: null, bankId: null, fuelSales: [{ fuelType: { name: 'HSD' } }],
    } as any);

    await svc.createFuelSale({
      branchId, fuelTypeId: 'fuel-HSD', quantityLiters: 1, pricePerLiter: 260, paymentMethod: 'cash',
    } as any, userId, orgId);

    expect(prisma.qBSyncQueue.createMany).not.toHaveBeenCalled();
  });

  it('enqueue DB error → does not propagate (sale persistence wins)', async () => {
    (prisma.sale.create as jest.MockedFunction<any>).mockResolvedValue({
      id: 'sale-4', saleDate: new Date(), customerId: null, bankId: null, fuelSales: [{ fuelType: { name: 'HSD' } }],
    } as any);
    (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mockRejectedValue(new Error('DB hiccup'));

    const result = await svc.createFuelSale({
      branchId, fuelTypeId: 'fuel-HSD', quantityLiters: 1, pricePerLiter: 260, paymentMethod: 'cash',
    } as any, userId, orgId);
    expect((result as any).id).toBe('sale-4');
  });
});

describe('SalesService.createNonFuelSale → QB enqueue', () => {
  beforeEach(resetMocks);

  it('enqueues one job with one lineItem per product', async () => {
    (prisma.product.findMany as jest.MockedFunction<any>).mockResolvedValue([
      { id: 'p-A', name: 'Filter A' },
      { id: 'p-B', name: 'Filter B' },
    ] as any);
    (prisma.sale.create as jest.MockedFunction<any>).mockResolvedValue({
      id: 'sale-nf-1', saleDate: new Date('2026-04-19'), customerId: null, bankId: null,
    } as any);
    (prisma.stockLevel.updateMany as jest.MockedFunction<any>).mockResolvedValue({ count: 1 } as any);

    await svc.createNonFuelSale({
      branchId,
      items: [
        { productId: 'p-A', quantity: 2, unitPrice: 500 },
        { productId: 'p-B', quantity: 1, unitPrice: 800 },
      ],
      paymentMethod: 'cash',
    } as any, userId, orgId);

    const row = (prisma.qBSyncQueue.createMany as jest.MockedFunction<any>).mock.calls[0][0].data[0];
    expect(row.jobType).toBe('create_sales_receipt');
    expect(row.payload.lineItems).toHaveLength(2);
    expect(row.payload.lineItems[0]).toEqual(expect.objectContaining({
      fuelTypeId: 'p-A', fuelTypeName: 'Filter A', quantity: 2, unitPrice: 500, amount: 1000,
    }));
    expect(row.payload.totalAmount).toBe(1800);
  });
});
