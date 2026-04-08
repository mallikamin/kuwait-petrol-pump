import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateMeterReadingInput } from './meter-readings.schema';
import { getBusinessDate } from '../../utils/timezone';

type CreateMeterReadingData = CreateMeterReadingInput;

export class MeterReadingsService {
  /**
   * Get all meter readings for an organization
   *
   * @param businessDate - Optional business date filter (YYYY-MM-DD string or Date object)
   *                       Filters by shift_instance.date (business date), NOT by timestamps
   */
  async getAllReadings(
    organizationId: string,
    limit: number = 100,
    isOcr?: boolean,
    businessDate?: string | Date,
    nozzleId?: string,
    shiftInstanceId?: string,
    readingType?: 'opening' | 'closing'
  ) {
    // Convert businessDate string to Date if provided
    const dateFilter = businessDate ? new Date(businessDate) : undefined;
    if (dateFilter) {
      dateFilter.setUTCHours(0, 0, 0, 0); // Normalize to start of day
    }

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
        ...(nozzleId && { nozzleId }),
        ...(shiftInstanceId && { shiftInstanceId }),
        ...(readingType && { readingType }),
        // CRITICAL: Filter by shift_instance.date (business date), NOT recordedAt timestamp
        ...(dateFilter && {
          shiftInstance: {
            date: dateFilter,
          },
        }),
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
            openedByUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
              },
            },
          },
        },
        recordedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        submittedByUser: {
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
    const { nozzleId, shiftInstanceId, shiftId, readingType, meterValue, imageUrl, imageBase64, ocrResult, isOcr, ocrConfidence, isManualOverride, customTimestamp, attachmentUrl, ocrManuallyEdited } = data as CreateMeterReadingData & { customTimestamp?: string; attachmentUrl?: string; ocrManuallyEdited?: boolean };

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

    // If shiftId provided instead of shiftInstanceId, get/create shift instance for the target date
    if (!resolvedShiftInstanceId && shiftId) {
      // Use customTimestamp if provided (for backdated entries), otherwise use business date
      const targetDate = customTimestamp
        ? new Date(customTimestamp)
        : await getBusinessDate(organizationId);

      // Normalize to business date (remove time component)
      const businessDateOnly = new Date(targetDate);
      businessDateOnly.setUTCHours(0, 0, 0, 0);

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

      // Find or create shift instance for the target date
      let shiftInstance = await prisma.shiftInstance.findUnique({
        where: {
          shiftId_date: {
            shiftId,
            date: businessDateOnly,
          },
        },
      });

      if (!shiftInstance) {
        // Auto-create shift instance if it doesn't exist (for backdated entries)
        shiftInstance = await prisma.shiftInstance.create({
          data: {
            shiftId,
            branchId: shift.branchId,
            date: businessDateOnly, // Business date (normalized)
            openedAt: customTimestamp ? new Date(customTimestamp) : new Date(), // Use custom timestamp for backdated entries
            openedBy: userId,
            status: 'open', // Will be closed manually later
          },
        });
        console.log(`✅ Auto-created shift instance for ${businessDateOnly.toISOString().split('T')[0]} (backdated entry)`);
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
      include: {
        shift: true, // Include shift details for auto-propagation logic
      },
    });

    if (!shiftInstance) {
      throw new AppError(404, 'Shift instance not found');
    }

    // For backdated entries (customTimestamp provided), allow recording on any shift status
    // For current entries, require shift to be open
    const isBackdatedEntry = !!customTimestamp;
    if (!isBackdatedEntry && shiftInstance.status !== 'open') {
      throw new AppError(400, 'Cannot record reading for a closed shift');
    }

    // For backdated entries, get the latest reading for THIS SHIFT INSTANCE (not globally)
    // For current entries, get the latest reading globally
    const latestReading = isBackdatedEntry
      ? await prisma.meterReading.findFirst({
          where: {
            nozzleId,
            shiftInstanceId: resolvedShiftInstanceId,
          },
          orderBy: { recordedAt: 'desc' },
        })
      : await prisma.meterReading.findFirst({
          where: { nozzleId },
          orderBy: { recordedAt: 'desc' },
        });

    // For backdated entries, skip strict meter value validation (allow manual corrections)
    // For current entries, validate meter value is greater than previous reading
    if (!isBackdatedEntry && latestReading && new Decimal(meterValue).lessThanOrEqualTo(latestReading.meterValue)) {
      throw new AppError(400, `Meter value (${meterValue}) must be greater than the last reading (${latestReading.meterValue.toString()})`);
    }

    // VALIDATION: Closing → Opening Continuity
    // When submitting an OPENING reading, check if yesterday's CLOSING exists and matches
    if (readingType === 'opening') {
      // CRITICAL: Calculate yesterday using BUSINESS DATE, not server system time
      const today = await getBusinessDate(organizationId);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setUTCHours(0, 0, 0, 0);

      // Query by shift_instance.date (business date), NOT by recordedAt timestamp
      const yesterdayClosing = await prisma.meterReading.findFirst({
        where: {
          nozzleId,
          readingType: 'closing',
          shiftInstance: {
            date: yesterday,
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
        // Audit metadata
        submittedBy: userId, // Set submitter to current user
        submittedAt: new Date(), // Set submission time to now
        ...(attachmentUrl && { attachmentUrl }),
        ...(ocrManuallyEdited !== undefined && { ocrManuallyEdited }),
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

    // AUTO-PROPAGATE: Closing → Next Opening (SHIFT-AWARE)
    // - Day Shift closing → Same day Night Shift opening
    // - Night Shift closing → Next day Day Shift opening
    if (readingType === 'closing') {
      try {
        const isNightShift = shiftInstance.shift.name.toLowerCase().includes('night');
        let targetDate: Date;
        let targetShiftName: string;

        if (isNightShift) {
          // Night shift closing → Next day Day shift opening
          targetDate = new Date(shiftInstance.date);
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(0, 0, 0, 0);
          targetShiftName = 'Day Shift';
        } else {
          // Day shift closing → Same day Night shift opening
          targetDate = new Date(shiftInstance.date);
          targetDate.setHours(0, 0, 0, 0);
          targetShiftName = 'Night Shift';
        }

        // Find target shift template
        const targetShift = await prisma.shift.findFirst({
          where: {
            branchId: shiftInstance.branchId,
            name: targetShiftName,
            isActive: true,
          },
        });

        if (!targetShift) {
          console.warn(`[FORWARD] Target shift "${targetShiftName}" not found, skipping auto-propagation`);
          return meterReading;
        }

        // Find or create target shift instance
        let targetShiftInstance = await prisma.shiftInstance.findFirst({
          where: {
            shiftId: targetShift.id,
            date: targetDate,
          },
        });

        if (!targetShiftInstance) {
          targetShiftInstance = await prisma.shiftInstance.create({
            data: {
              shiftId: targetShift.id,
              branchId: shiftInstance.branchId,
              date: targetDate,
              openedAt: customTimestamp ? new Date(customTimestamp) : new Date(),
              openedBy: userId,
              status: 'open',
            },
          });
          console.log(`✅ [FORWARD] Auto-created ${targetShiftName} instance for ${targetDate.toISOString().split('T')[0]}`);
        }

        // Check if opening already exists
        const existingOpening = await prisma.meterReading.findFirst({
          where: {
            nozzleId,
            shiftInstanceId: targetShiftInstance.id,
            readingType: 'opening',
          },
        });

        // Create opening if missing
        if (!existingOpening) {
          await prisma.meterReading.create({
            data: {
              nozzleId,
              shiftInstanceId: targetShiftInstance.id,
              readingType: 'opening',
              meterValue: new Decimal(meterValue),
              isManualOverride: false,
              isOcr: false,
              recordedBy: userId,
              recordedAt: new Date(),
            },
          });

          console.log(`✅ [FORWARD] ${shiftInstance.shift.name} closing → ${targetShiftName} opening (${targetDate.toISOString().split('T')[0]}) = ${meterValue}L`);
        }
      } catch (error) {
        console.error('[FORWARD] Failed to auto-propagate closing to next opening:', error);
      }
    }

    // AUTO-PROPAGATE: Opening → Previous Closing (SHIFT-AWARE)
    // - Day Shift opening → Previous day Night Shift closing
    // - Night Shift opening → Same day Day Shift closing
    if (readingType === 'opening') {
      try {
        const isNightShift = shiftInstance.shift.name.toLowerCase().includes('night');
        let targetDate: Date;
        let targetShiftName: string;

        if (isNightShift) {
          // Night shift opening → Same day Day shift closing
          targetDate = new Date(shiftInstance.date);
          targetDate.setHours(0, 0, 0, 0);
          targetShiftName = 'Day Shift';
        } else {
          // Day shift opening → Previous day Night shift closing
          targetDate = new Date(shiftInstance.date);
          targetDate.setDate(targetDate.getDate() - 1);
          targetDate.setHours(0, 0, 0, 0);
          targetShiftName = 'Night Shift';
        }

        // Find target shift template
        const targetShift = await prisma.shift.findFirst({
          where: {
            branchId: shiftInstance.branchId,
            name: targetShiftName,
            isActive: true,
          },
        });

        if (!targetShift) {
          console.warn(`[BACKWARD] Target shift "${targetShiftName}" not found, skipping auto-propagation`);
          return meterReading;
        }

        // Find or create target shift instance
        let targetShiftInstance = await prisma.shiftInstance.findFirst({
          where: {
            shiftId: targetShift.id,
            date: targetDate,
          },
        });

        if (!targetShiftInstance) {
          targetShiftInstance = await prisma.shiftInstance.create({
            data: {
              shiftId: targetShift.id,
              branchId: shiftInstance.branchId,
              date: targetDate,
              openedAt: customTimestamp ? new Date(customTimestamp) : new Date(),
              openedBy: userId,
              status: 'open',
            },
          });
          console.log(`✅ [BACKWARD] Auto-created ${targetShiftName} instance for ${targetDate.toISOString().split('T')[0]}`);
        }

        // Check if closing already exists
        const existingClosing = await prisma.meterReading.findFirst({
          where: {
            nozzleId,
            shiftInstanceId: targetShiftInstance.id,
            readingType: 'closing',
          },
        });

        // Create closing if missing
        if (!existingClosing) {
          await prisma.meterReading.create({
            data: {
              nozzleId,
              shiftInstanceId: targetShiftInstance.id,
              readingType: 'closing',
              meterValue: new Decimal(meterValue),
              isManualOverride: false,
              isOcr: false,
              recordedBy: userId,
              recordedAt: new Date(),
            },
          });

          console.log(`✅ [BACKWARD] ${shiftInstance.shift.name} opening → ${targetShiftName} closing (${targetDate.toISOString().split('T')[0]}) = ${meterValue}L`);
        }
      } catch (error) {
        console.error('[BACKWARD] Failed to auto-propagate opening to prev closing:', error);
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

  /**
   * Update meter reading value (for correcting mistakes)
   */
  async updateMeterReading(
    id: string,
    newMeterValue: number,
    userId: string,
    organizationId: string,
    attachmentUrl?: string,
    ocrManuallyEdited?: boolean
  ) {
    // Find the reading
    const reading = await prisma.meterReading.findFirst({
      where: {
        id,
        shiftInstance: {
          branch: {
            organizationId,
          },
        },
      },
      include: {
        shiftInstance: true,
      },
    });

    if (!reading) {
      throw new AppError(404, 'Meter reading not found');
    }

    // Don't allow editing if shift is closed
    if (reading.shiftInstance.status === 'closed') {
      throw new AppError(400, 'Cannot update reading for a closed shift');
    }

    // Update the meter value and audit metadata
    const updated = await prisma.meterReading.update({
      where: { id },
      data: {
        meterValue: new Decimal(newMeterValue),
        ...(attachmentUrl && { attachmentUrl }),
        ...(ocrManuallyEdited !== undefined && { ocrManuallyEdited }),
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
          },
        },
        shiftInstance: {
          include: {
            shift: true,
          },
        },
      },
    });

    console.log(`✅ Updated meter reading ${id}: ${reading.meterValue} → ${newMeterValue} (by user ${userId})`);

    return updated;
  }

  /**
   * Delete meter reading (for removing wrong entries)
   */
  async deleteMeterReading(
    id: string,
    userId: string,
    organizationId: string
  ) {
    // Find the reading
    const reading = await prisma.meterReading.findFirst({
      where: {
        id,
        shiftInstance: {
          branch: {
            organizationId,
          },
        },
      },
      include: {
        shiftInstance: true,
        nozzle: {
          include: {
            fuelType: true,
          },
        },
      },
    });

    if (!reading) {
      throw new AppError(404, 'Meter reading not found');
    }

    // Don't allow deleting if shift is closed
    if (reading.shiftInstance.status === 'closed') {
      throw new AppError(400, 'Cannot delete reading for a closed shift');
    }

    // Delete the reading
    await prisma.meterReading.delete({
      where: { id },
    });

    console.log(`🗑️ Deleted meter reading ${id} (${reading.readingType} ${reading.meterValue} for nozzle ${reading.nozzle.name}) by user ${userId}`);

    return { success: true };
  }
}
