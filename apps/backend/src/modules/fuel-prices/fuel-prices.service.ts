import { prisma } from '../../config/database';

export class FuelPricesService {
  async getCurrentPrices() {
    const now = new Date();

    const prices = await prisma.fuelPrice.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [
          { effectiveTo: null },
          // Half-open interval [effectiveFrom, effectiveTo): the row is no
          // longer active at the exact instant a successor takes over, so
          // boundary queries return a single row.
          { effectiveTo: { gt: now } },
        ],
      },
      include: {
        fuelType: true,
        changedByUser: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    return prices;
  }

  async getPriceHistory(fuelTypeId?: string, limit = 50) {
    return prisma.fuelPrice.findMany({
      where: fuelTypeId ? { fuelTypeId } : undefined,
      include: {
        fuelType: true,
        changedByUser: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
      take: limit,
    });
  }

  async updatePrice(
    fuelTypeId: string,
    price: number,
    effectiveFrom: Date,
    changedBy: string,
    notes?: string
  ) {
    // End previous price
    await prisma.fuelPrice.updateMany({
      where: {
        fuelTypeId,
        effectiveTo: null,
      },
      data: {
        effectiveTo: effectiveFrom,
      },
    });

    // Create new price
    const newPrice = await prisma.fuelPrice.create({
      data: {
        fuelTypeId,
        pricePerLiter: price,
        effectiveFrom,
        changedBy,
        notes,
      },
      include: {
        fuelType: true,
      },
    });

    return newPrice;
  }

  async getFuelTypes() {
    return prisma.fuelType.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Get fuel prices effective for a specific date
   * Used for backdated transactions to get historical prices
   */
  async getPricesForDate(date: Date) {
    const prices = await prisma.fuelPrice.findMany({
      where: {
        effectiveFrom: { lte: date },
        OR: [
          { effectiveTo: null },
          // Half-open interval [effectiveFrom, effectiveTo). See getCurrentPrices.
          { effectiveTo: { gt: date } },
        ],
      },
      include: {
        fuelType: true,
        changedByUser: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    return prices;
  }
}
