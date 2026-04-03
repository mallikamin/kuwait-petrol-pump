import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateBackdatedEntryInput } from './backdated-entries.schema';

export class BackdatedEntriesService {
  /**
   * Create a backdated entry (meter readings + bifurcation)
   * NO SHIFT REQUIRED - for accountant backlog processing
   */
  async createBackdatedEntry(
    data: CreateBackdatedEntryInput,
    userId: string,
    organizationId: string
  ) {
    const {
      date,
      nozzleId,
      openingReading,
      closingReading,
      creditCardSales,
      bankCardSales,
      psoCardSales,
      notes,
    } = data;

    // Validate date is not in the future
    if (date > new Date()) {
      throw new AppError(400, 'Cannot create backdated entry for future date');
    }

    // Verify nozzle exists and belongs to organization
    const nozzle = await prisma.nozzle.findFirst({
      where: {
        id: nozzleId,
        dispensingUnit: {
          branch: {
            organizationId,
          },
        },
      },
      include: {
        fuelType: true,
        dispensingUnit: {
          include: {
            branch: true,
          },
        },
      },
    });

    if (!nozzle || !nozzle.isActive) {
      throw new AppError(404, 'Nozzle not found or inactive');
    }

    // Get or create a shift instance for this date
    // For backdated entries, we create a "backdated" shift instance
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    // Get the default shift for this branch (Day Shift)
    const defaultShift = await prisma.shift.findFirst({
      where: {
        branchId: nozzle.dispensingUnit.branchId,
        isActive: true,
      },
      orderBy: {
        shiftNumber: 'asc',
      },
    });

    if (!defaultShift) {
      throw new AppError(404, 'No shift template found for this branch');
    }

    // Find or create shift instance for this date
    let shiftInstance = await prisma.shiftInstance.findUnique({
      where: {
        shiftId_date: {
          shiftId: defaultShift.id,
          date: dateOnly,
        },
      },
    });

    if (!shiftInstance) {
      // Create a backdated shift instance (status: closed since it's historical)
      shiftInstance = await prisma.shiftInstance.create({
        data: {
          shiftId: defaultShift.id,
          branchId: nozzle.dispensingUnit.branchId,
          date: dateOnly,
          openedAt: dateOnly,
          openedBy: userId,
          closedAt: new Date(dateOnly.getTime() + 12 * 60 * 60 * 1000), // 12 hours later
          closedBy: userId,
          status: 'closed', // Backdated entries are always closed
          notes: `Backdated entry created by ${userId}`,
        },
      });
    }

    // Check if readings already exist for this nozzle + date
    const existingOpening = await prisma.meterReading.findFirst({
      where: {
        nozzleId,
        shiftInstanceId: shiftInstance.id,
        readingType: 'opening',
      },
    });

    const existingClosing = await prisma.meterReading.findFirst({
      where: {
        nozzleId,
        shiftInstanceId: shiftInstance.id,
        readingType: 'closing',
      },
    });

    if (existingOpening || existingClosing) {
      throw new AppError(400, 'Meter readings already exist for this nozzle on this date');
    }

    // Calculate sales volume (in liters)
    const salesVolume = closingReading - openingReading;

    // Get fuel price for this date
    const fuelPrice = await prisma.fuelPrice.findFirst({
      where: {
        fuelTypeId: nozzle.fuelTypeId,
        effectiveDate: {
          lte: dateOnly,
        },
      },
      orderBy: {
        effectiveDate: 'desc',
      },
    });

    if (!fuelPrice) {
      throw new AppError(404, `No fuel price found for ${nozzle.fuelType.name} on ${dateOnly.toISOString().split('T')[0]}`);
    }

    // Calculate total sales amount
    const totalSalesAmount = salesVolume * parseFloat(fuelPrice.price.toString());

    // Calculate cash sales (total - card sales)
    const totalCardSales = (creditCardSales || 0) + (bankCardSales || 0) + (psoCardSales || 0);
    const cashSales = totalSalesAmount - totalCardSales;

    if (cashSales < 0) {
      throw new AppError(400, `Card sales (${totalCardSales.toFixed(2)}) exceed total sales (${totalSalesAmount.toFixed(2)})`);
    }

    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create opening reading
      const openingMeterReading = await tx.meterReading.create({
        data: {
          nozzleId,
          shiftInstanceId: shiftInstance.id,
          readingType: 'opening',
          meterValue: new Decimal(openingReading),
          recordedAt: dateOnly, // Use backdated timestamp
          recordedBy: userId,
          isManualOverride: true,
          isOcr: false,
        },
      });

      // 2. Create closing reading
      const closingMeterReading = await tx.meterReading.create({
        data: {
          nozzleId,
          shiftInstanceId: shiftInstance.id,
          readingType: 'closing',
          meterValue: new Decimal(closingReading),
          recordedAt: new Date(dateOnly.getTime() + 12 * 60 * 60 * 1000), // 12 hours after opening
          recordedBy: userId,
          isManualOverride: true,
          isOcr: false,
        },
      });

      // 3. Create bifurcation entry (payment breakdown)
      const bifurcation = await tx.bifurcation.create({
        data: {
          shiftInstanceId: shiftInstance.id,
          branchId: nozzle.dispensingUnit.branchId,
          totalSales: new Decimal(totalSalesAmount),
          cashSales: new Decimal(cashSales),
          creditCardSales: new Decimal(creditCardSales || 0),
          bankCardSales: new Decimal(bankCardSales || 0),
          psoCardSales: new Decimal(psoCardSales || 0),
          actualCashInHand: new Decimal(cashSales), // Assume it matches for backdated entries
          shortageOrExcess: new Decimal(0),
          notes: notes || `Backdated entry for ${dateOnly.toISOString().split('T')[0]}`,
          createdBy: userId,
        },
      });

      return {
        openingMeterReading,
        closingMeterReading,
        bifurcation,
        shiftInstance,
        calculatedValues: {
          salesVolume,
          totalSalesAmount,
          cashSales,
          totalCardSales,
        },
      };
    });

    return result;
  }

  /**
   * Get backdated entries summary
   */
  async getBackdatedEntries(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 50
  ) {
    const where: any = {
      branch: {
        organizationId,
      },
      notes: {
        contains: 'Backdated entry',
      },
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const entries = await prisma.shiftInstance.findMany({
      where,
      include: {
        shift: true,
        branch: true,
        bifurcations: true,
        meterReadings: {
          include: {
            nozzle: {
              include: {
                fuelType: true,
                dispensingUnit: true,
              },
            },
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
      take: limit,
    });

    return entries;
  }
}
