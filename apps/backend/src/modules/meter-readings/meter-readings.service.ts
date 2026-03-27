import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateMeterReadingInput } from './meter-readings.schema';

type CreateMeterReadingData = CreateMeterReadingInput;

export class MeterReadingsService {
  /**
   * Create a new meter reading
   */
  async createMeterReading(data: CreateMeterReadingData, userId: string, organizationId: string) {
    const { nozzleId, shiftInstanceId, readingType, meterValue, imageUrl, ocrResult, isManualOverride } = data;

    // Verify nozzle belongs to organization
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

    // Verify shift instance belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    if (shiftInstance.status !== 'open') {
      throw new AppError(400, 'Cannot record reading for a closed shift');
    }

    // Get the latest reading for this nozzle to validate
    const latestReading = await prisma.meterReading.findFirst({
      where: { nozzleId },
      orderBy: { recordedAt: 'desc' },
    });

    // Validate meter value is greater than previous reading
    if (latestReading && new Decimal(meterValue).lessThanOrEqualTo(latestReading.meterValue)) {
      throw new AppError(400, `Meter value (${meterValue}) must be greater than the last reading (${latestReading.meterValue.toString()})`);
    }

    // Check if reading already exists for this nozzle and shift
    const existingReading = await prisma.meterReading.findFirst({
      where: {
        nozzleId,
        shiftInstanceId,
        readingType,
      },
    });

    if (existingReading) {
      throw new AppError(400, `${readingType} reading already exists for this nozzle in this shift`);
    }

    // Create meter reading
    const meterReading = await prisma.meterReading.create({
      data: {
        nozzleId,
        shiftInstanceId,
        readingType,
        meterValue: new Decimal(meterValue),
        ...(imageUrl && { imageUrl }),
        ...(ocrResult && { ocrResult: new Decimal(ocrResult) }),
        isManualOverride,
        recordedBy: userId,
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: {
              include: {
                branch: true,
              },
            },
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return meterReading;
  }

  /**
   * Get latest meter reading for a nozzle
   */
  async getLatestReading(nozzleId: string, organizationId: string) {
    // Verify nozzle belongs to organization
    const nozzle = await prisma.nozzle.findFirst({
      where: {
        id: nozzleId,
        dispensingUnit: {
          branch: {
            organizationId,
          },
        },
      },
    });

    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    const latestReading = await prisma.meterReading.findFirst({
      where: { nozzleId },
      orderBy: { recordedAt: 'desc' },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return latestReading;
  }

  /**
   * Verify/update meter reading (for manual correction)
   */
  async verifyReading(
    readingId: string,
    organizationId: string,
    verifiedValue: number,
    isManualOverride: boolean
  ) {
    // Verify reading belongs to organization
    const reading = await prisma.meterReading.findFirst({
      where: {
        id: readingId,
        nozzle: {
          dispensingUnit: {
            branch: {
              organizationId,
            },
          },
        },
      },
      include: {
        nozzle: true,
        shiftInstance: true,
      },
    });

    if (!reading) {
      throw new AppError(404, 'Meter reading not found');
    }

    // Get the previous reading to validate
    const previousReading = await prisma.meterReading.findFirst({
      where: {
        nozzleId: reading.nozzleId,
        recordedAt: {
          lt: reading.recordedAt,
        },
      },
      orderBy: { recordedAt: 'desc' },
    });

    // Validate verified value is greater than previous reading
    if (previousReading && new Decimal(verifiedValue).lessThanOrEqualTo(previousReading.meterValue)) {
      throw new AppError(400, `Verified value (${verifiedValue}) must be greater than the previous reading (${previousReading.meterValue.toString()})`);
    }

    // Update the reading
    const updatedReading = await prisma.meterReading.update({
      where: { id: readingId },
      data: {
        meterValue: new Decimal(verifiedValue),
        isManualOverride,
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: {
              include: {
                branch: true,
              },
            },
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    return updatedReading;
  }

  /**
   * Get all meter readings for a shift
   */
  async getReadingsByShift(shiftInstanceId: string, organizationId: string) {
    // Verify shift instance belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    const readings = await prisma.meterReading.findMany({
      where: { shiftInstanceId },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: [
        { nozzle: { dispensingUnit: { unitNumber: 'asc' } } },
        { nozzle: { nozzleNumber: 'asc' } },
        { readingType: 'asc' },
      ],
    });

    return readings;
  }

  /**
   * Get meter reading variance report (compare opening vs closing)
   */
  async getVarianceReport(shiftInstanceId: string, organizationId: string) {
    // Verify shift instance belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: shiftInstanceId,
        branch: {
          organizationId,
        },
      },
      include: {
        shift: true,
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    // Get all readings for this shift
    const readings = await prisma.meterReading.findMany({
      where: { shiftInstanceId },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
      },
      orderBy: [
        { nozzle: { dispensingUnit: { unitNumber: 'asc' } } },
        { nozzle: { nozzleNumber: 'asc' } },
      ],
    });

    // Group by nozzle and calculate variance
    const nozzleMap = new Map();

    for (const reading of readings) {
      if (!nozzleMap.has(reading.nozzleId)) {
        nozzleMap.set(reading.nozzleId, {
          nozzle: reading.nozzle,
          opening: null,
          closing: null,
        });
      }

      const nozzleData = nozzleMap.get(reading.nozzleId);
      if (reading.readingType === 'opening') {
        nozzleData.opening = reading;
      } else {
        nozzleData.closing = reading;
      }
    }

    // Calculate variance for each nozzle
    const varianceReport = Array.from(nozzleMap.values()).map((data) => {
      const opening = data.opening ? parseFloat(data.opening.meterValue.toString()) : null;
      const closing = data.closing ? parseFloat(data.closing.meterValue.toString()) : null;
      const variance = opening !== null && closing !== null ? closing - opening : null;

      return {
        nozzle: data.nozzle,
        openingReading: data.opening,
        closingReading: data.closing,
        variance,
      };
    });

    return {
      shiftInstance,
      varianceReport,
    };
  }
}
