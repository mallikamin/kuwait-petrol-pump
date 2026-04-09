import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

/**
 * BackdatedMeterReadingsDailyService (SHIFT-INDEPENDENT VERSION)
 *
 * P0 FIX: No longer relies on shift_instances.
 * Sources data from backdated_meter_readings table only.
 *
 * Key changes:
 * - No shift segregation (backdated is day-level, not shift-level)
 * - No auto-derivation from adjacent shifts
 * - Readings are either 'entered' or 'missing'
 * - Cleaner accounting math (no phantom shifts)
 */

export interface MeterReadingStatus {
  nozzleId: string;
  nozzleName: string;
  fuelType: string;
  fuelTypeName: string;
  opening?: {
    value: number | null;
    status: 'entered' | 'missing';
    recordedBy?: string;
    recordedAt?: Date;
    imageUrl?: string;
    submittedBy?: string; // User ID
    submittedByName?: string; // User full name
    submittedAt?: Date;
    attachmentUrl?: string;
    ocrManuallyEdited?: boolean;
  };
  closing?: {
    value: number | null;
    status: 'entered' | 'missing';
    recordedBy?: string;
    recordedAt?: Date;
    imageUrl?: string;
    submittedBy?: string; // User ID
    submittedByName?: string; // User full name
    submittedAt?: Date;
    attachmentUrl?: string;
    ocrManuallyEdited?: boolean;
  };
}

export interface DailyMeterReadingsResponse {
  businessDate: string;
  branchId: string;
  nozzles: MeterReadingStatus[];
  summary: {
    totalNozzles: number;
    totalReadingsExpected: number; // nozzles × 2 (opening + closing)
    totalReadingsEntered: number;
    totalReadingsMissing: number;
    completionPercent: number;
  };
}

export interface SaveMeterReadingInput {
  nozzleId: string;
  readingType: 'opening' | 'closing';
  meterValue: number;
  source?: 'manual' | 'ocr';
  imageUrl?: string;
  attachmentUrl?: string;
  ocrConfidence?: number;
  ocrManuallyEdited?: boolean;
}

export class BackdatedMeterReadingsDailyService {
  /**
   * Get meter readings for a specific business date (no shift segregation)
   */
  async getDailyMeterReadings(
    branchId: string,
    businessDate: string, // YYYY-MM-DD
    organizationId: string
  ): Promise<DailyMeterReadingsResponse> {
    console.log('[BackdatedMeterReadings] getDailyMeterReadings:', {
      branchId,
      businessDate,
      organizationId,
    });

    // Validate branch belongs to organization
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        organizationId,
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found or does not belong to organization');
    }

    // Parse business date
    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    // Get all nozzles for the branch
    const nozzles = await prisma.nozzle.findMany({
      where: {
        dispensingUnit: {
          branchId,
        },
        isActive: true,
      },
      include: {
        fuelType: true,
        dispensingUnit: true,
      },
      orderBy: [
        { dispensingUnit: { unitNumber: 'asc' } },
        { nozzleNumber: 'asc' },
      ],
    });

    console.log(`[BackdatedMeterReadings] Found ${nozzles.length} active nozzles`);

    // Get backdated meter readings for this date
    const readings = await prisma.backdatedMeterReading.findMany({
      where: {
        branchId,
        businessDate: businessDateObj,
      },
      include: {
        nozzle: {
          include: {
            fuelType: true,
            dispensingUnit: true,
          },
        },
        submittedByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
          },
        },
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${readings.length} readings for ${businessDate}`);

    // Build readings map
    const readingsMap = new Map<string, typeof readings>();
    for (const reading of readings) {
      const key = `${reading.nozzleId}:${reading.readingType}`;
      readingsMap.set(key, [reading]);
    }

    // Build response
    const nozzleStatuses: MeterReadingStatus[] = nozzles.map((nozzle) => {
      const openingKey = `${nozzle.id}:opening`;
      const closingKey = `${nozzle.id}:closing`;

      const openingReadings = readingsMap.get(openingKey) || [];
      const closingReadings = readingsMap.get(closingKey) || [];

      const openingReading = openingReadings[0];
      const closingReading = closingReadings[0];

      return {
        nozzleId: nozzle.id,
        nozzleName: `D${nozzle.dispensingUnit.unitNumber}N${nozzle.nozzleNumber}`,
        fuelType: nozzle.fuelType.code,
        fuelTypeName: nozzle.fuelType.name,
        opening: openingReading
          ? {
              value: Number(openingReading.meterValue),
              status: 'entered' as const,
              recordedBy: openingReading.createdBy || undefined,
              recordedAt: openingReading.createdAt,
              imageUrl: openingReading.imageUrl || undefined,
              submittedBy: openingReading.submittedBy || undefined,
              submittedByName: openingReading.submittedByUser?.fullName || undefined,
              submittedAt: openingReading.submittedAt || undefined,
              attachmentUrl: openingReading.attachmentUrl || undefined,
              ocrManuallyEdited: openingReading.ocrManuallyEdited,
            }
          : {
              value: null,
              status: 'missing' as const,
            },
        closing: closingReading
          ? {
              value: Number(closingReading.meterValue),
              status: 'entered' as const,
              recordedBy: closingReading.createdBy || undefined,
              recordedAt: closingReading.createdAt,
              imageUrl: closingReading.imageUrl || undefined,
              submittedBy: closingReading.submittedBy || undefined,
              submittedByName: closingReading.submittedByUser?.fullName || undefined,
              submittedAt: closingReading.submittedAt || undefined,
              attachmentUrl: closingReading.attachmentUrl || undefined,
              ocrManuallyEdited: closingReading.ocrManuallyEdited,
            }
          : {
              value: null,
              status: 'missing' as const,
            },
      };
    });

    // Calculate summary
    const totalNozzles = nozzles.length;
    const totalReadingsExpected = totalNozzles * 2; // opening + closing
    const totalReadingsEntered = readings.length;
    const totalReadingsMissing = totalReadingsExpected - totalReadingsEntered;
    const completionPercent =
      totalReadingsExpected > 0 ? (totalReadingsEntered / totalReadingsExpected) * 100 : 0;

    return {
      businessDate,
      branchId,
      nozzles: nozzleStatuses,
      summary: {
        totalNozzles,
        totalReadingsExpected,
        totalReadingsEntered,
        totalReadingsMissing,
        completionPercent: Math.round(completionPercent * 100) / 100,
      },
    };
  }

  /**
   * Save or update meter readings for a business date
   */
  async saveMeterReadings(
    branchId: string,
    businessDate: string,
    organizationId: string,
    readings: SaveMeterReadingInput[],
    userId: string
  ): Promise<{ saved: number; errors: string[] }> {
    console.log('[BackdatedMeterReadings] saveMeterReadings:', {
      branchId,
      businessDate,
      count: readings.length,
    });

    // Validate branch
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    const errors: string[] = [];
    let saved = 0;

    for (const reading of readings) {
      try {
        await prisma.backdatedMeterReading.upsert({
          where: {
            unique_branch_date_nozzle_type: {
              branchId,
              businessDate: businessDateObj,
              nozzleId: reading.nozzleId,
              readingType: reading.readingType,
            },
          },
          create: {
            organizationId,
            branchId,
            businessDate: businessDateObj,
            nozzleId: reading.nozzleId,
            readingType: reading.readingType,
            meterValue: reading.meterValue,
            source: reading.source || 'manual',
            imageUrl: reading.imageUrl,
            attachmentUrl: reading.attachmentUrl,
            ocrConfidence: reading.ocrConfidence,
            ocrManuallyEdited: reading.ocrManuallyEdited || false,
            createdBy: userId,
            submittedBy: userId,
            submittedAt: new Date(),
          },
          update: {
            meterValue: reading.meterValue,
            source: reading.source || 'manual',
            imageUrl: reading.imageUrl,
            attachmentUrl: reading.attachmentUrl,
            ocrConfidence: reading.ocrConfidence,
            ocrManuallyEdited: reading.ocrManuallyEdited || false,
            updatedBy: userId,
          },
        });
        saved++;
      } catch (error: any) {
        errors.push(`Nozzle ${reading.nozzleId} ${reading.readingType}: ${error.message}`);
      }
    }

    return { saved, errors };
  }
}
