import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateMeterReadingInput } from './meter-readings.schema';

type CreateMeterReadingData = CreateMeterReadingInput;

export class MeterReadingsService {
  /**
   * Get all meter readings for an organization
   */
  async getAllReadings(organizationId: string, limit: number = 100, isOcr?: boolean) {
    const readings = await prisma.meterReading.findMany({
      where: {
        nozzle: {
          dispensingUnit: {
            branch: {
              organizationId,
            },
          },
        },
        ...(isOcr !== undefined && { isOcr }),
      },
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
      orderBy: {
        recordedAt: 'desc',
      },
      take: limit,
    });

    return readings;
  }

  /**
   * Create a new meter reading
   */
  async createMeterReading(data: CreateMeterReadingData, userId: string, organizationId: string) {
    const { nozzleId, shiftInstanceId, shiftId, readingType, meterValue, imageUrl, imageBase64, ocrResult, isOcr, ocrConfidence, isManualOverride, customTimestamp } = data as CreateMeterReadingData & { customTimestamp?: string };

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

    // Determine the shift instance ID
    let resolvedShiftInstanceId = shiftInstanceId;

    // If shiftId provided instead of shiftInstanceId, get/create today's shift instance
    if (!resolvedShiftInstanceId && shiftId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Verify shift exists and belongs to organization
      const shift = await prisma.shift.findFirst({
        where: {
          id: shiftId,
          branch: {
            organizationId,
          },
          isActive: true,
        },
      });

      if (!shift) {
        throw new AppError(404, 'Shift not found or inactive');
      }

      // Find or create today's shift instance
      let shiftInstance = await prisma.shiftInstance.findUnique({
        where: {
          shiftId_date: {
            shiftId,
            date: today,
          },
        },
      });

      if (!shiftInstance) {
        // Auto-create shift instance if it doesn't exist
        shiftInstance = await prisma.shiftInstance.create({
          data: {
            shiftId,
            branchId: shift.branchId,
            date: today,
            openedAt: new Date(),
            openedBy: userId,
            status: 'open',
          },
        });
      }

      resolvedShiftInstanceId = shiftInstance.id;
    }

    if (!resolvedShiftInstanceId) {
      throw new AppError(400, 'Either shiftInstanceId or shiftId must be provided');
    }

    // Verify shift instance belongs to organization
    const shiftInstance = await prisma.shiftInstance.findFirst({
      where: {
        id: resolvedShiftInstanceId,
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

    // VALIDATION: Closing → Opening Continuity
    // When submitting an OPENING reading, check if yesterday's CLOSING exists and matches
    if (readingType === 'opening') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const yesterdayClosing = await prisma.meterReading.findFirst({
        where: {
          nozzleId,
          readingType: 'closing',
          recordedAt: {
            gte: yesterday,
            lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000), // Within yesterday
          },
        },
        orderBy: { recordedAt: 'desc' },
      });

      if (yesterdayClosing) {
        const closingValue = parseFloat(yesterdayClosing.meterValue.toString());
        const openingValue = parseFloat(meterValue.toString());
        const variance = Math.abs(openingValue - closingValue);
        const tolerance = 0.01; // 0.01 liters tolerance

        if (variance > tolerance) {
          // Log warning but don't block (operator might have a valid reason)
          console.warn(
            `⚠️ Opening reading mismatch for nozzle ${nozzleId}:`,
            `Yesterday's closing: ${closingValue}, Today's opening: ${openingValue}, Variance: ${variance}`
          );
          // You could optionally throw an error here if you want to enforce strict continuity:
          // throw new AppError(400, `Opening reading (${openingValue}) does not match yesterday's closing (${closingValue}). Variance: ${variance.toFixed(2)}`);
        }
      }
    }

    // Check if reading already exists for this nozzle and shift
    const existingReading = await prisma.meterReading.findFirst({
      where: {
        nozzleId,
        shiftInstanceId: resolvedShiftInstanceId,
        readingType,
      },
    });

    if (existingReading) {
      throw new AppError(400, `${readingType} reading already exists for this nozzle in this shift`);
    }

    // Process image if base64 provided (mobile app submission)
    let finalImageUrl = imageUrl;
    if (imageBase64 && !imageUrl) {
      // Save base64 image to disk for audit trail
      const { saveBase64Image } = await import('../../utils/image-storage');
      finalImageUrl = await saveBase64Image(imageBase64, {
        nozzleId,
        userId,
        readingType,
      });
    }

    // Create meter reading with optional custom timestamp for back-dated entries
    const recordedAt = customTimestamp ? new Date(customTimestamp) : new Date();

    // Validate custom timestamp is not in the future
    if (customTimestamp && recordedAt > new Date()) {
      throw new AppError(400, 'Cannot create meter reading with future timestamp');
    }

    // Create meter reading
    const meterReading = await prisma.meterReading.create({
      data: {
        nozzleId,
        shiftInstanceId: resolvedShiftInstanceId,
        readingType,
        meterValue: new Decimal(meterValue),
        recordedAt, // Use custom timestamp if provided, else current time
        ...(finalImageUrl && { imageUrl: finalImageUrl }),
        ...(ocrResult && { ocrResult: new Decimal(ocrResult) }),
        ...(isOcr !== undefined && { isOcr }),
        ...(ocrConfidence !== undefined && { ocrConfidence }),
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

    // AUTO-PROPAGATE: Closing of Day X → Opening of Day X+1
    if (readingType === 'closing') {
      try {
        const nextDay = new Date(shiftInstance.date);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);

        // Find next day's shift instance for the same shift template
        const nextDayShiftInstance = await prisma.shiftInstance.findFirst({
          where: {
            shiftId: shiftInstance.shiftId,
            date: nextDay,
            status: 'open',
          },
        });

        // Only auto-create opening if next day's shift is already open
        if (nextDayShiftInstance) {
          // Check if opening already exists
          const existingNextOpening = await prisma.meterReading.findFirst({
            where: {
              nozzleId,
              shiftInstanceId: nextDayShiftInstance.id,
              readingType: 'opening',
            },
          });

          // If no opening exists, auto-create it with today's closing value
          if (!existingNextOpening) {
            await prisma.meterReading.create({
              data: {
                nozzleId,
                shiftInstanceId: nextDayShiftInstance.id,
                readingType: 'opening',
                meterValue: new Decimal(meterValue), // Use today's closing value
                isManualOverride: false,
                isOcr: false,
                recordedBy: userId,
                recordedAt: new Date(), // Record at current time
              },
            });

            console.log(`✅ Auto-created opening reading for nozzle ${nozzleId} on ${nextDay.toISOString().split('T')[0]} with value ${meterValue}`);
          }
        }
      } catch (error) {
        // Log but don't fail the main operation
        console.error('Failed to auto-propagate closing to next opening:', error);
      }
    }

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
