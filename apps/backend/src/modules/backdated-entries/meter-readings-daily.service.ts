import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * BackdatedMeterReadingsDailyService (SHIFT-SEGREGATED VERSION)
 *
 * Shift-wise meter readings with auto-propagation and continuity validation:
 * - Morning closing → Evening opening (same day)
 * - Evening closing → Next day Morning opening (cross-day)
 * - Bidirectional: Opening → Previous closing (backward)
 *
 * Key features:
 * - Shift segregation (readings per shift per nozzle)
 * - Bidirectional auto-propagation
 * - Continuity validation (warn on gaps > 0.01L)
 * - Sales calculation guard (only when both readings valid)
 */

export interface MeterReadingStatus {
  id?: string;
  value: number | null;
  status: 'entered' | 'propagated_forward' | 'propagated_backward' | 'missing';
  recordedBy?: string;
  recordedAt?: Date;
  imageUrl?: string;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: Date;
  attachmentUrl?: string;
  ocrManuallyEdited?: boolean;
  propagatedFrom?: {
    shiftName: string;
    date: string;
    readingType: 'closing' | 'opening';
  };
}

export interface ShiftMeterReadingStatus {
  nozzleId: string;
  nozzleName: string;
  fuelType: string;
  fuelTypeName: string;
  opening?: MeterReadingStatus;
  closing?: MeterReadingStatus;
  salesLiters?: number;
  continuityWarning?: string;
}

export interface ShiftSummary {
  shiftId: string;
  shiftName: string;
  shiftNumber: number;
  startTime: string;
  endTime: string;
  nozzles: ShiftMeterReadingStatus[];
  summary: {
    totalNozzles: number;
    totalReadingsExpected: number;
    totalReadingsEntered: number;
    totalReadingsPropagated: number;
    totalReadingsMissing: number;
    completionPercent: number;
    totalSalesLiters: number;
  };
}

export interface DailyMeterReadingsResponse {
  businessDate: string;
  branchId: string;
  shifts: ShiftSummary[];
  aggregateSummary: {
    totalShifts: number;
    totalNozzles: number;
    totalReadingsExpected: number;
    totalReadingsEntered: number;
    totalReadingsPropagated: number;
    totalReadingsMissing: number;
    completionPercent: number;
    totalSalesLiters: number;
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

const CONTINUITY_TOLERANCE = 0.01; // 0.01L tolerance

export class BackdatedMeterReadingsDailyService {
  /**
   * Get meter readings for a business date (shift-segregated)
   */
  async getDailyMeterReadings(
    branchId: string,
    businessDate: string,
    organizationId: string
  ): Promise<DailyMeterReadingsResponse> {
    console.log('[BackdatedMeterReadings] getDailyMeterReadings:', {
      branchId,
      businessDate,
      organizationId,
    });

    // Validate branch
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Parse business date
    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    // Get all shifts for branch (ordered by shiftNumber)
    const shifts = await prisma.shift.findMany({
      where: { branchId, isActive: true },
      orderBy: { shiftNumber: 'asc' },
    });

    console.log(`[BackdatedMeterReadings] Found ${shifts.length} shifts`);

    // Get all nozzles
    const nozzles = await prisma.nozzle.findMany({
      where: { dispensingUnit: { branchId }, isActive: true },
      include: { fuelType: true, dispensingUnit: true },
      orderBy: [
        { dispensingUnit: { unitNumber: 'asc' } },
        { nozzleNumber: 'asc' },
      ],
    });

    console.log(`[BackdatedMeterReadings] Found ${nozzles.length} nozzles`);

    // Get all backdated readings for this date (all shifts)
    const readings = await prisma.backdatedMeterReading.findMany({
      where: { branchId, businessDate: businessDateObj },
      include: {
        nozzle: { include: { fuelType: true, dispensingUnit: true } },
        shift: true,
        submittedByUser: { select: { id: true, fullName: true } },
      },
    });

    console.log(`[BackdatedMeterReadings] Found ${readings.length} readings`);

    // Build response per shift
    const shiftSummaries: ShiftSummary[] = [];
    let totalEntered = 0;
    let totalPropagated = 0;
    let totalMissing = 0;
    let totalSalesLiters = 0;

    for (const shift of shifts) {
      const shiftReadings = readings.filter((r) => r.shiftId === shift.id);
      const nozzleStatuses: ShiftMeterReadingStatus[] = [];
      let shiftTotalSales = 0;
      let shiftEntered = 0;
      let shiftPropagated = 0;

      for (const nozzle of nozzles) {
        const openingReading = shiftReadings.find(
          (r) => r.nozzleId === nozzle.id && r.readingType === 'opening'
        );
        const closingReading = shiftReadings.find(
          (r) => r.nozzleId === nozzle.id && r.readingType === 'closing'
        );

        let openingStatus: MeterReadingStatus;
        let closingStatus: MeterReadingStatus;

        // Process opening reading
        if (openingReading) {
          openingStatus = {
            id: openingReading.id,
            value: Number(openingReading.meterValue),
            status: 'entered',
            recordedAt: openingReading.createdAt,
            submittedBy: openingReading.submittedBy,
            submittedByName: openingReading.submittedByUser?.fullName,
            submittedAt: openingReading.submittedAt,
            attachmentUrl: openingReading.attachmentUrl || undefined,
            ocrManuallyEdited: openingReading.ocrManuallyEdited,
          };
          shiftEntered++;
        } else {
          // Try to derive from previous shift closing
          const propagated = await this.getPropagatedOpening(
            nozzle.id,
            shift,
            businessDateObj,
            branchId
          );
          if (propagated) {
            openingStatus = {
              value: propagated.value,
              status: 'propagated_backward',
              propagatedFrom: propagated.propagatedFrom,
            };
            shiftPropagated++;
          } else {
            openingStatus = { value: null, status: 'missing' };
          }
        }

        // Process closing reading
        if (closingReading) {
          closingStatus = {
            id: closingReading.id,
            value: Number(closingReading.meterValue),
            status: 'entered',
            recordedAt: closingReading.createdAt,
            submittedBy: closingReading.submittedBy,
            submittedByName: closingReading.submittedByUser?.fullName,
            submittedAt: closingReading.submittedAt,
            attachmentUrl: closingReading.attachmentUrl || undefined,
            ocrManuallyEdited: closingReading.ocrManuallyEdited,
          };
          shiftEntered++;
        } else {
          // Try to derive from next shift opening
          const propagated = await this.getPropagatedClosing(
            nozzle.id,
            shift,
            businessDateObj,
            branchId
          );
          if (propagated) {
            closingStatus = {
              value: propagated.value,
              status: 'propagated_forward',
              propagatedFrom: propagated.propagatedFrom,
            };
            shiftPropagated++;
          } else {
            closingStatus = { value: null, status: 'missing' };
          }
        }

        // Calculate sales only if both readings valid
        let salesLiters: number | undefined;
        if (
          openingStatus.value !== null &&
          openingStatus.value > 0 &&
          closingStatus.value !== null &&
          closingStatus.value > 0
        ) {
          salesLiters = Number(closingStatus.value) - Number(openingStatus.value);
          shiftTotalSales += salesLiters;
        }

        // Check continuity (warn if gap detected)
        const continuityWarning = await this.checkContinuity(
          nozzle.id,
          shift,
          businessDateObj,
          openingStatus
        );

        nozzleStatuses.push({
          nozzleId: nozzle.id,
          nozzleName: `D${nozzle.dispensingUnit.unitNumber}N${nozzle.nozzleNumber}`,
          fuelType: nozzle.fuelType.code,
          fuelTypeName: nozzle.fuelType.name,
          opening: openingStatus,
          closing: closingStatus,
          salesLiters,
          continuityWarning,
        });
      }

      totalEntered += shiftEntered;
      totalPropagated += shiftPropagated;
      totalMissing += nozzles.length * 2 - shiftEntered - shiftPropagated;
      totalSalesLiters += shiftTotalSales;

      const completionPercent =
        nozzles.length * 2 > 0
          ? ((shiftEntered + shiftPropagated) / (nozzles.length * 2)) * 100
          : 0;

      shiftSummaries.push({
        shiftId: shift.id,
        shiftName: shift.name || `Shift ${shift.shiftNumber}`,
        shiftNumber: shift.shiftNumber,
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
        nozzles: nozzleStatuses,
        summary: {
          totalNozzles: nozzles.length,
          totalReadingsExpected: nozzles.length * 2,
          totalReadingsEntered: shiftEntered,
          totalReadingsPropagated: shiftPropagated,
          totalReadingsMissing: nozzles.length * 2 - shiftEntered - shiftPropagated,
          completionPercent: Math.round(completionPercent * 100) / 100,
          totalSalesLiters: Math.round(shiftTotalSales * 1000) / 1000,
        },
      });
    }

    // Aggregate summary
    const totalExpected = nozzles.length * shifts.length * 2;
    const aggregateCompletion =
      totalExpected > 0 ? ((totalEntered + totalPropagated) / totalExpected) * 100 : 0;

    return {
      businessDate,
      branchId,
      shifts: shiftSummaries,
      aggregateSummary: {
        totalShifts: shifts.length,
        totalNozzles: nozzles.length,
        totalReadingsExpected: totalExpected,
        totalReadingsEntered: totalEntered,
        totalReadingsPropagated: totalPropagated,
        totalReadingsMissing: totalMissing,
        completionPercent: Math.round(aggregateCompletion * 100) / 100,
        totalSalesLiters: Math.round(totalSalesLiters * 1000) / 1000,
      },
    };
  }

  /**
   * Get propagated opening reading from previous shift closing
   * - Morning: Previous day Evening closing
   * - Evening: Same day Morning closing
   */
  private async getPropagatedOpening(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string
  ): Promise<{ value: number; propagatedFrom: any } | null> {
    const isMorning = shift.shiftNumber === 1;

    let targetDate: Date;
    let targetShiftNumber: number;

    if (isMorning) {
      // Morning → Previous day Evening
      targetDate = new Date(businessDate);
      targetDate.setDate(targetDate.getDate() - 1);
      targetShiftNumber = 2;
    } else {
      // Evening → Same day Morning
      targetDate = new Date(businessDate);
      targetShiftNumber = 1;
    }

    const targetShift = await prisma.shift.findFirst({
      where: { branchId, shiftNumber: targetShiftNumber, isActive: true },
    });

    if (!targetShift) return null;

    const previousClosing = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'closing',
      },
    });

    if (!previousClosing) return null;

    return {
      value: Number(previousClosing.meterValue),
      propagatedFrom: {
        shiftName: targetShift.name || `Shift ${targetShift.shiftNumber}`,
        date: targetDate.toISOString().split('T')[0],
        readingType: 'closing',
      },
    };
  }

  /**
   * Get propagated closing reading from next shift opening
   * - Morning: Same day Evening opening
   * - Evening: Next day Morning opening
   */
  private async getPropagatedClosing(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string
  ): Promise<{ value: number; propagatedFrom: any } | null> {
    const isMorning = shift.shiftNumber === 1;

    let targetDate: Date;
    let targetShiftNumber: number;

    if (isMorning) {
      // Morning → Same day Evening
      targetDate = new Date(businessDate);
      targetShiftNumber = 2;
    } else {
      // Evening → Next day Morning
      targetDate = new Date(businessDate);
      targetDate.setDate(targetDate.getDate() + 1);
      targetShiftNumber = 1;
    }

    const targetShift = await prisma.shift.findFirst({
      where: { branchId, shiftNumber: targetShiftNumber, isActive: true },
    });

    if (!targetShift) return null;

    const nextOpening = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'opening',
      },
    });

    if (!nextOpening) return null;

    return {
      value: Number(nextOpening.meterValue),
      propagatedFrom: {
        shiftName: targetShift.name || `Shift ${targetShift.shiftNumber}`,
        date: targetDate.toISOString().split('T')[0],
        readingType: 'opening',
      },
    };
  }

  /**
   * Check continuity: opening reading matches expected (previous closing)
   * Returns warning if gap > tolerance (0.01L)
   */
  private async checkContinuity(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    openingStatus: MeterReadingStatus
  ): Promise<string | null> {
    // Only check if opening is entered (not missing or propagated)
    if (openingStatus.status !== 'entered' || openingStatus.value === null) {
      return null;
    }

    const currentOpening = openingStatus.value;

    // Get expected opening (previous shift closing)
    const isMorning = shift.shiftNumber === 1;
    let expectedDate: Date;
    let expectedShiftNumber: number;

    if (isMorning) {
      expectedDate = new Date(businessDate);
      expectedDate.setDate(expectedDate.getDate() - 1);
      expectedShiftNumber = 2;
    } else {
      expectedDate = new Date(businessDate);
      expectedShiftNumber = 1;
    }

    const branchId = shift.branchId || (await this.getBranchFromShift(shift.id));

    const expectedShift = await prisma.shift.findFirst({
      where: { branchId, shiftNumber: expectedShiftNumber, isActive: true },
    });

    if (!expectedShift) return null;

    const expectedReading = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: expectedDate,
        shiftId: expectedShift.id,
        nozzleId,
        readingType: 'closing',
      },
    });

    if (!expectedReading) return null;

    const expectedValue = Number(expectedReading.meterValue);
    const gap = Math.abs(currentOpening - expectedValue);

    if (gap > CONTINUITY_TOLERANCE) {
      return `Gap of ${gap.toFixed(3)}L detected with ${expectedShift.name || `Shift ${expectedShift.shiftNumber}`} closing on ${expectedDate.toISOString().split('T')[0]}`;
    }

    return null;
  }

  /**
   * Save a single meter reading with auto-propagation
   */
  async saveSingleMeterReading(
    branchId: string,
    businessDate: string,
    shiftId: string,
    organizationId: string,
    input: SaveMeterReadingInput,
    userId: string
  ): Promise<{ id: string; nozzleId: string; readingType: string; meterValue: number }> {
    console.log('[BackdatedMeterReadings] saveSingleMeterReading:', {
      branchId,
      businessDate,
      shiftId,
      nozzleId: input.nozzleId,
      readingType: input.readingType,
      meterValue: input.meterValue,
    });

    // Validate branch
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    // Validate shift
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, branchId, isActive: true },
    });
    if (!shift) {
      throw new AppError(404, 'Shift not found');
    }

    // Validate nozzle
    const nozzle = await prisma.nozzle.findFirst({
      where: { id: input.nozzleId, dispensingUnit: { branchId } },
    });
    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    // Save the reading
    const reading = await prisma.backdatedMeterReading.upsert({
      where: {
        unique_branch_date_shift_nozzle_type: {
          branchId,
          businessDate: businessDateObj,
          shiftId,
          nozzleId: input.nozzleId,
          readingType: input.readingType,
        },
      },
      create: {
        organizationId,
        branchId,
        businessDate: businessDateObj,
        shiftId,
        nozzleId: input.nozzleId,
        readingType: input.readingType,
        meterValue: new Decimal(input.meterValue),
        source: input.source || 'manual',
        imageUrl: input.imageUrl,
        attachmentUrl: input.attachmentUrl,
        ocrConfidence: input.ocrConfidence,
        ocrManuallyEdited: input.ocrManuallyEdited || false,
        createdBy: userId,
        submittedBy: userId,
        submittedAt: new Date(),
      },
      update: {
        meterValue: new Decimal(input.meterValue),
        source: input.source || 'manual',
        imageUrl: input.imageUrl,
        attachmentUrl: input.attachmentUrl,
        ocrConfidence: input.ocrConfidence,
        ocrManuallyEdited: input.ocrManuallyEdited || false,
        updatedBy: userId,
        submittedAt: new Date(),
      },
    });

    // AUTO-PROPAGATE (non-blocking, try-catch)
    try {
      if (input.readingType === 'closing') {
        await this.propagateClosingToNextOpening(
          input.nozzleId,
          shift,
          businessDateObj,
          branchId,
          Number(reading.meterValue),
          userId
        );
      } else if (input.readingType === 'opening') {
        await this.propagateOpeningToPreviousClosing(
          input.nozzleId,
          shift,
          businessDateObj,
          branchId,
          Number(reading.meterValue),
          userId
        );
      }
    } catch (error: any) {
      console.warn('[Auto-Propagate] Non-blocking error:', error.message);
      // Don't fail the save operation
    }

    return {
      id: reading.id,
      nozzleId: reading.nozzleId,
      readingType: reading.readingType,
      meterValue: Number(reading.meterValue),
    };
  }

  /**
   * Propagate closing to next shift opening
   * - Morning closing → Same day Evening opening
   * - Evening closing → Next day Morning opening
   */
  private async propagateClosingToNextOpening(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string,
    meterValue: number,
    userId: string
  ): Promise<void> {
    const isMorning = shift.shiftNumber === 1;

    let targetDate: Date;
    let targetShiftNumber: number;

    if (isMorning) {
      targetDate = new Date(businessDate);
      targetShiftNumber = 2;
    } else {
      targetDate = new Date(businessDate);
      targetDate.setDate(targetDate.getDate() + 1);
      targetShiftNumber = 1;
    }

    const targetShift = await prisma.shift.findFirst({
      where: { branchId, shiftNumber: targetShiftNumber, isActive: true },
    });

    if (!targetShift) {
      console.log(`[FORWARD] Target shift not found for propagation`);
      return;
    }

    // Check if opening already exists
    const existing = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'opening',
      },
    });

    if (!existing) {
      const org = await prisma.branch.findFirst({
        where: { id: branchId },
        select: { organizationId: true },
      });

      await prisma.backdatedMeterReading.create({
        data: {
          organizationId: org!.organizationId,
          branchId,
          businessDate: targetDate,
          shiftId: targetShift.id,
          nozzleId,
          readingType: 'opening',
          meterValue: new Decimal(meterValue),
          source: 'manual',
          createdBy: userId,
          submittedBy: userId,
          submittedAt: new Date(),
        },
      });
      console.log(
        `✅ [FORWARD] Propagated ${shift.name} closing → ${targetShift.name} opening = ${meterValue}L`
      );
    }
  }

  /**
   * Propagate opening to previous shift closing (backward)
   */
  private async propagateOpeningToPreviousClosing(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string,
    meterValue: number,
    userId: string
  ): Promise<void> {
    const isMorning = shift.shiftNumber === 1;

    let targetDate: Date;
    let targetShiftNumber: number;

    if (isMorning) {
      targetDate = new Date(businessDate);
      targetDate.setDate(targetDate.getDate() - 1);
      targetShiftNumber = 2;
    } else {
      targetDate = new Date(businessDate);
      targetShiftNumber = 1;
    }

    const targetShift = await prisma.shift.findFirst({
      where: { branchId, shiftNumber: targetShiftNumber, isActive: true },
    });

    if (!targetShift) {
      console.log(`[BACKWARD] Target shift not found for propagation`);
      return;
    }

    // Check if closing already exists
    const existing = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'closing',
      },
    });

    if (!existing) {
      const org = await prisma.branch.findFirst({
        where: { id: branchId },
        select: { organizationId: true },
      });

      await prisma.backdatedMeterReading.create({
        data: {
          organizationId: org!.organizationId,
          branchId,
          businessDate: targetDate,
          shiftId: targetShift.id,
          nozzleId,
          readingType: 'closing',
          meterValue: new Decimal(meterValue),
          source: 'manual',
          createdBy: userId,
          submittedBy: userId,
          submittedAt: new Date(),
        },
      });
      console.log(
        `✅ [BACKWARD] Propagated ${shift.name} opening → ${targetShift.name} closing = ${meterValue}L`
      );
    }
  }

  /**
   * Helper: Get branch ID from shift
   */
  private async getBranchFromShift(shiftId: string): Promise<string> {
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      select: { branchId: true },
    });
    return shift?.branchId || '';
  }

  /**
   * Update a meter reading by ID
   */
  async updateMeterReading(
    readingId: string,
    organizationId: string,
    updates: {
      meterValue?: number;
      attachmentUrl?: string;
      ocrManuallyEdited?: boolean;
    },
    userId: string
  ): Promise<{ id: string; meterValue: number }> {
    console.log('[BackdatedMeterReadings] updateMeterReading:', { readingId });

    const reading = await prisma.backdatedMeterReading.findFirst({
      where: { id: readingId, branchId: undefined }, // TODO: validate org
    });

    if (!reading) {
      throw new AppError(404, 'Meter reading not found');
    }

    const updated = await prisma.backdatedMeterReading.update({
      where: { id: readingId },
      data: {
        meterValue:
          updates.meterValue !== undefined ? new Decimal(updates.meterValue) : reading.meterValue,
        attachmentUrl:
          updates.attachmentUrl !== undefined ? updates.attachmentUrl : reading.attachmentUrl,
        ocrManuallyEdited:
          updates.ocrManuallyEdited !== undefined
            ? updates.ocrManuallyEdited
            : reading.ocrManuallyEdited,
        updatedBy: userId,
      },
    });

    return {
      id: updated.id,
      meterValue: Number(updated.meterValue),
    };
  }

  /**
   * Delete a meter reading by ID
   */
  async deleteMeterReading(readingId: string, organizationId: string): Promise<void> {
    console.log('[BackdatedMeterReadings] deleteMeterReading:', { readingId });

    const reading = await prisma.backdatedMeterReading.findFirst({
      where: { id: readingId },
    });

    if (!reading) {
      throw new AppError(404, 'Meter reading not found');
    }

    await prisma.backdatedMeterReading.delete({
      where: { id: readingId },
    });
  }
}
