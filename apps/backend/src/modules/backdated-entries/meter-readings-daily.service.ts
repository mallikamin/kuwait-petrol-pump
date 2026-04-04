import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

/**
 * BackdatedMeterReadingsDailyService
 *
 * Provides shift-segregated view of meter readings for backdated entry workflow.
 * Sources data from meter_readings + shift_instances (NOT backdated_entries).
 *
 * Implements bi-directional auto-chain logic:
 * - Evening closing (Day N) → Morning opening (Day N+1)
 * - Morning closing (Day N) → Evening opening (Day N)
 * - Morning opening (Day N) ← Evening closing (Day N-1)
 */

export interface MeterReadingStatus {
  nozzleId: string;
  nozzleName: string;
  fuelType: string;
  fuelTypeName: string;
  opening?: {
    value: number | null;
    status: 'entered' | 'derived_from_prev_shift' | 'derived_from_next_shift' | 'missing';
    shiftInstanceId?: string;
    recordedBy?: string;
    recordedAt?: Date;
    imageUrl?: string;
  };
  closing?: {
    value: number | null;
    status: 'entered' | 'derived_from_prev_shift' | 'derived_from_next_shift' | 'missing';
    shiftInstanceId?: string;
    recordedBy?: string;
    recordedAt?: Date;
    imageUrl?: string;
  };
}

export interface ShiftDayData {
  shiftId: string;
  shiftName: string;
  shiftNumber: number;
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
  nozzles: MeterReadingStatus[];
}

export interface DailyMeterReadingsResponse {
  businessDate: string;
  branchId: string;
  shifts: ShiftDayData[];
  summary: {
    totalNozzles: number;
    totalReadingsExpected: number; // nozzles × shifts × 2 (opening + closing)
    totalReadingsEntered: number;
    totalReadingsDerived: number;
    totalReadingsMissing: number;
    completionPercent: number;
  };
}

export class BackdatedMeterReadingsDailyService {
  /**
   * Get shift-segregated meter readings for a specific business date
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

    // Get all shifts for the branch
    const shifts = await prisma.shift.findMany({
      where: {
        branchId,
        isActive: true,
      },
      orderBy: {
        shiftNumber: 'asc',
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${shifts.length} active shifts`);

    // Get shift instances for this date
    const shiftInstances = await prisma.shiftInstance.findMany({
      where: {
        branchId,
        date: businessDateObj,
      },
      include: {
        shift: true,
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
        shift: {
          shiftNumber: 'asc',
        },
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${shiftInstances.length} shift instances for ${businessDate}`);

    // Get previous day's shift instances (for derivation logic)
    const prevDate = new Date(businessDateObj);
    prevDate.setDate(prevDate.getDate() - 1);

    const prevDayShiftInstances = await prisma.shiftInstance.findMany({
      where: {
        branchId,
        date: prevDate,
      },
      include: {
        shift: true,
        meterReadings: {
          include: {
            nozzle: true,
          },
        },
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${prevDayShiftInstances.length} shift instances for previous day`);

    // Get next day's shift instances (for derivation logic)
    const nextDate = new Date(businessDateObj);
    nextDate.setDate(nextDate.getDate() + 1);

    const nextDayShiftInstances = await prisma.shiftInstance.findMany({
      where: {
        branchId,
        date: nextDate,
      },
      include: {
        shift: true,
        meterReadings: {
          include: {
            nozzle: true,
          },
        },
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${nextDayShiftInstances.length} shift instances for next day`);

    // Build shift-segregated matrix
    const shiftsData: ShiftDayData[] = shifts.map((shift) => {
      const shiftInstance = shiftInstances.find((si) => si.shiftId === shift.id);

      const nozzleData: MeterReadingStatus[] = nozzles.map((nozzle) => {
        // Find existing meter readings for this nozzle in this shift instance
        const openingReading = shiftInstance?.meterReadings.find(
          (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'opening'
        );
        const closingReading = shiftInstance?.meterReadings.find(
          (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'closing'
        );

        // Derive opening from previous shift if missing
        let derivedOpening: { value: number | null; status: MeterReadingStatus['opening']['status'] } | null = null;
        if (!openingReading) {
          // Try to derive from previous shift's closing
          if (shift.shiftNumber === 1) {
            // Morning shift - derive from previous day's last shift closing
            const lastShift = shifts[shifts.length - 1];
            const prevDayLastShiftInstance = prevDayShiftInstances.find((si) => si.shiftId === lastShift.id);
            const prevDayClosing = prevDayLastShiftInstance?.meterReadings.find(
              (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'closing'
            );
            if (prevDayClosing) {
              derivedOpening = {
                value: parseFloat(prevDayClosing.meterValue.toString()),
                status: 'derived_from_prev_shift',
              };
            }
          } else {
            // Other shifts - derive from same day previous shift closing
            const prevShift = shifts.find((s) => s.shiftNumber === shift.shiftNumber - 1);
            if (prevShift) {
              const prevShiftInstance = shiftInstances.find((si) => si.shiftId === prevShift.id);
              const prevClosing = prevShiftInstance?.meterReadings.find(
                (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'closing'
              );
              if (prevClosing) {
                derivedOpening = {
                  value: parseFloat(prevClosing.meterValue.toString()),
                  status: 'derived_from_prev_shift',
                };
              }
            }
          }
        }

        // Derive closing from next shift if missing
        let derivedClosing: { value: number | null; status: MeterReadingStatus['closing']['status'] } | null = null;
        if (!closingReading) {
          // Try to derive from next shift's opening
          if (shift.shiftNumber === shifts.length) {
            // Last shift - derive from next day's first shift opening
            const firstShift = shifts[0];
            const nextDayFirstShiftInstance = nextDayShiftInstances.find((si) => si.shiftId === firstShift.id);
            const nextDayOpening = nextDayFirstShiftInstance?.meterReadings.find(
              (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'opening'
            );
            if (nextDayOpening) {
              derivedClosing = {
                value: parseFloat(nextDayOpening.meterValue.toString()),
                status: 'derived_from_next_shift',
              };
            }
          } else {
            // Other shifts - derive from same day next shift opening
            const nextShift = shifts.find((s) => s.shiftNumber === shift.shiftNumber + 1);
            if (nextShift) {
              const nextShiftInstance = shiftInstances.find((si) => si.shiftId === nextShift.id);
              const nextOpening = nextShiftInstance?.meterReadings.find(
                (mr) => mr.nozzleId === nozzle.id && mr.readingType === 'opening'
              );
              if (nextOpening) {
                derivedClosing = {
                  value: parseFloat(nextOpening.meterValue.toString()),
                  status: 'derived_from_next_shift',
                };
              }
            }
          }
        }

        return {
          nozzleId: nozzle.id,
          nozzleName: nozzle.name || `D${nozzle.dispensingUnit.unitNumber}N${nozzle.nozzleNumber}`,
          fuelType: nozzle.fuelType.code,
          fuelTypeName: nozzle.fuelType.name,
          opening: openingReading
            ? {
                value: parseFloat(openingReading.meterValue.toString()),
                status: 'entered' as const,
                shiftInstanceId: shiftInstance?.id,
                recordedBy: openingReading.recordedBy || undefined,
                recordedAt: openingReading.recordedAt,
                imageUrl: openingReading.imageUrl || undefined,
              }
            : derivedOpening
            ? {
                value: derivedOpening.value,
                status: derivedOpening.status,
              }
            : {
                value: null,
                status: 'missing' as const,
              },
          closing: closingReading
            ? {
                value: parseFloat(closingReading.meterValue.toString()),
                status: 'entered' as const,
                shiftInstanceId: shiftInstance?.id,
                recordedBy: closingReading.recordedBy || undefined,
                recordedAt: closingReading.recordedAt,
                imageUrl: closingReading.imageUrl || undefined,
              }
            : derivedClosing
            ? {
                value: derivedClosing.value,
                status: derivedClosing.status,
              }
            : {
                value: null,
                status: 'missing' as const,
              },
        };
      });

      return {
        shiftId: shift.id,
        shiftName: shift.name || `Shift ${shift.shiftNumber}`,
        shiftNumber: shift.shiftNumber,
        startTime: shift.startTime.toISOString().split('T')[1].split('.')[0],
        endTime: shift.endTime.toISOString().split('T')[1].split('.')[0],
        nozzles: nozzleData,
      };
    });

    // Calculate summary stats
    const totalNozzles = nozzles.length;
    const totalShifts = shifts.length;
    const totalReadingsExpected = totalNozzles * totalShifts * 2; // opening + closing per nozzle per shift

    let totalReadingsEntered = 0;
    let totalReadingsDerived = 0;
    let totalReadingsMissing = 0;

    shiftsData.forEach((shift) => {
      shift.nozzles.forEach((nozzle) => {
        if (nozzle.opening.status === 'entered') totalReadingsEntered++;
        else if (nozzle.opening.status === 'missing') totalReadingsMissing++;
        else totalReadingsDerived++;

        if (nozzle.closing.status === 'entered') totalReadingsEntered++;
        else if (nozzle.closing.status === 'missing') totalReadingsMissing++;
        else totalReadingsDerived++;
      });
    });

    const completionPercent = totalReadingsExpected > 0
      ? Math.round(((totalReadingsEntered + totalReadingsDerived) / totalReadingsExpected) * 100)
      : 0;

    return {
      businessDate,
      branchId,
      shifts: shiftsData,
      summary: {
        totalNozzles,
        totalReadingsExpected,
        totalReadingsEntered,
        totalReadingsDerived,
        totalReadingsMissing,
        completionPercent,
      },
    };
  }
}
