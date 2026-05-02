import { FuelPricesService } from './fuel-prices.service';
import { prisma } from '../../config/database';

jest.mock('../../config/database', () => ({
  prisma: {
    fuelPrice: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    fuelType: {
      findMany: jest.fn(),
    },
  },
}));

describe('FuelPricesService — boundary-overlap regression', () => {
  let service: FuelPricesService;

  beforeEach(() => {
    service = new FuelPricesService();
    jest.clearAllMocks();
    (prisma.fuelPrice.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('getPricesForDate uses half-open interval (effectiveTo gt, not gte)', async () => {
    const date = new Date('2026-05-01T00:00:00.000Z');

    await service.getPricesForDate(date);

    expect(prisma.fuelPrice.findMany).toHaveBeenCalledTimes(1);
    const args = (prisma.fuelPrice.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { effectiveTo: null },
      { effectiveTo: { gt: date } },
    ]);
    // Sanity: must not regress to gte (returning the previous row's last instant
    // alongside the new row's first instant — the bug fixed by this change).
    expect(JSON.stringify(args.where)).not.toContain('"gte"');
  });

  it('getCurrentPrices uses half-open interval (effectiveTo gt, not gte)', async () => {
    await service.getCurrentPrices();

    expect(prisma.fuelPrice.findMany).toHaveBeenCalledTimes(1);
    const args = (prisma.fuelPrice.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0]).toEqual({ effectiveTo: null });
    expect(args.where.OR[1]).toHaveProperty('effectiveTo.gt');
    expect(args.where.OR[1].effectiveTo).not.toHaveProperty('gte');
  });
});
