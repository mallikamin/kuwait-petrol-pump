import { BootstrapService } from './bootstrap.service';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

jest.mock('../../config/database', () => ({
  prisma: {
    inventoryBootstrap: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const branchId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const productIdA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const fuelTypeIdHSD = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const userId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('BootstrapService.listBootstrap', () => {
  let service: BootstrapService;
  beforeEach(() => {
    service = new BootstrapService();
    jest.clearAllMocks();
  });

  it('maps product rows with display metadata and sorts fuel first', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r1',
        branchId,
        productId: productIdA,
        fuelTypeId: null,
        asOfDate: new Date('2026-01-01T00:00:00.000Z'),
        quantity: 42 as any,
        source: 'bootstrap_2026-01-01',
        notes: null,
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        product: { id: productIdA, name: 'Filter A', sku: 'SKU-A', category: 'Oil' },
        fuelType: null,
        updatedByUser: null,
      },
      {
        id: 'r2',
        branchId,
        productId: null,
        fuelTypeId: fuelTypeIdHSD,
        asOfDate: new Date('2026-01-01T00:00:00.000Z'),
        quantity: 1000 as any,
        source: 'user_entered',
        notes: 'tanks measured',
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        product: null,
        fuelType: { id: fuelTypeIdHSD, code: 'HSD', name: 'High Speed Diesel' },
        updatedByUser: { id: userId, username: 'admin', fullName: 'Admin User' },
      },
    ]);

    const rows = await service.listBootstrap({ branchId, asOfDate: '2026-01-01' });
    expect(rows).toHaveLength(2);
    // Fuel (HSD) sorts ahead of non-fuel
    expect(rows[0].productType).toBe('HSD');
    expect(rows[0].unit).toBe('L');
    expect(rows[0].updatedByName).toBe('Admin User');
    expect(rows[1].productType).toBe('non_fuel');
    expect(rows[1].unit).toBe('units');
    expect(rows[1].sku).toBe('SKU-A');
  });

  it('filters by category total_fuel', async () => {
    (prisma.inventoryBootstrap.findMany as jest.Mock).mockResolvedValue([
      { id: 'p', branchId, productId: productIdA, fuelTypeId: null, asOfDate: new Date('2026-01-01T00:00:00.000Z'), quantity: 1 as any, source: 's', notes: null, updatedAt: new Date(), product: { id: productIdA, name: 'X', sku: null, category: null }, fuelType: null, updatedByUser: null },
      { id: 'h', branchId, productId: null, fuelTypeId: fuelTypeIdHSD, asOfDate: new Date('2026-01-01T00:00:00.000Z'), quantity: 1 as any, source: 's', notes: null, updatedAt: new Date(), product: null, fuelType: { id: fuelTypeIdHSD, code: 'HSD', name: 'HSD' }, updatedByUser: null },
    ]);
    const rows = await service.listBootstrap({
      branchId,
      asOfDate: '2026-01-01',
      category: 'total_fuel',
    });
    expect(rows.every((r) => r.productType === 'HSD' || r.productType === 'PMG')).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

describe('BootstrapService.upsertBootstrap - validation', () => {
  let service: BootstrapService;
  beforeEach(() => {
    service = new BootstrapService();
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
  });

  it('rejects asOfDate that is not YYYY-MM-DD', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026/01/01',
        rows: [{ productId: productIdA, quantity: 1 }],
        updatedBy: userId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects empty rows array', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026-01-01',
        rows: [],
        updatedBy: userId,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a row with both productId and fuelTypeId set', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026-01-01',
        rows: [{ productId: productIdA, fuelTypeId: fuelTypeIdHSD, quantity: 1 }],
        updatedBy: userId,
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('exactly one of') });
  });

  it('rejects a row with neither productId nor fuelTypeId', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026-01-01',
        rows: [{ quantity: 1 }],
        updatedBy: userId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-finite quantity (NaN / Infinity)', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026-01-01',
        rows: [{ productId: productIdA, quantity: Number.NaN }],
        updatedBy: userId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects duplicate keys in the same request', async () => {
    await expect(
      service.upsertBootstrap({
        branchId,
        asOfDate: '2026-01-01',
        rows: [
          { productId: productIdA, quantity: 10 },
          { productId: productIdA, quantity: 20 },
        ],
        updatedBy: userId,
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('duplicate') });
  });
});

describe('BootstrapService.upsertBootstrap - write path', () => {
  let service: BootstrapService;
  beforeEach(() => {
    service = new BootstrapService();
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
  });

  it('updates an existing row and stamps source=user_entered + updatedBy', async () => {
    (prisma.inventoryBootstrap.findFirst as jest.Mock).mockResolvedValue({
      id: 'existing-1',
      notes: 'old-notes',
    });
    (prisma.inventoryBootstrap.update as jest.Mock).mockResolvedValue({});
    const result = await service.upsertBootstrap({
      branchId,
      asOfDate: '2026-01-01',
      rows: [{ productId: productIdA, quantity: 123.45, notes: null }],
      updatedBy: userId,
    });
    expect(result).toEqual({ updated: 1, created: 0 });
    expect(prisma.inventoryBootstrap.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        quantity: 123.45,
        source: 'user_entered',
        updatedBy: userId,
      }),
    });
  });

  it('creates a row when no existing bootstrap matches (new branch/product combo)', async () => {
    (prisma.inventoryBootstrap.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.inventoryBootstrap.create as jest.Mock).mockResolvedValue({});
    const result = await service.upsertBootstrap({
      branchId,
      asOfDate: '2026-01-01',
      rows: [{ fuelTypeId: fuelTypeIdHSD, quantity: 5000 }],
      updatedBy: userId,
    });
    expect(result).toEqual({ updated: 0, created: 1 });
    expect(prisma.inventoryBootstrap.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        branchId,
        productId: null,
        fuelTypeId: fuelTypeIdHSD,
        quantity: 5000,
        source: 'user_entered',
        updatedBy: userId,
      }),
    });
  });
});
