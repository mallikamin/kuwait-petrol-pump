import { prisma } from '../../config/database';

export class FuelPricesService {
  async getCurrentPrices() {
    const now = new Date();

    const prices = await prisma.fuelPrice.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: now } },
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
}
