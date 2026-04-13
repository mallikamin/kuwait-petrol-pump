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
    openingPropagatedCount: number;
    totalReadingsMissing: number;
    filledReadings: number;
    completionPercent: number;
    totalSalesLiters: number;
    // ✅ NEW: Product-wise sales breakdown
    hsdSalesLiters?: number;
    pmgSalesLiters?: number;
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
    openingPropagatedCount: number;
    totalReadingsMissing: number;
    filledReadings: number;
    completionPercent: number;
    totalSalesLiters: number;
    // ✅ NEW: Product-wise sales breakdown
    hsdSalesLiters?: number;
    pmgSalesLiters?: number;
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
  private async getCanonicalShift(branchId: string) {
    const shift = await prisma.shift.findFirst({
      where: { branchId, isActive: true },
      orderBy: { shiftNumber: 'asc' },
    });
    if (!shift) {
      throw new AppError(400, 'No active shift configured for branch');
    }
    return shift;
  }
  /**
   * Get meter readings for a business date (single canonical shift)
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

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);
    const canonicalShift = await this.getCanonicalShift(branchId);

    const nozzles = await prisma.nozzle.findMany({
      where: { dispensingUnit: { branchId }, isActive: true },
      include: { fuelType: true, dispensingUnit: true },
      orderBy: [
        { dispensingUnit: { unitNumber: 'asc' } },
        { nozzleNumber: 'asc' },
      ],
    });

    const readings = (await prisma.backdatedMeterReading.findMany({
      where: { branchId, businessDate: businessDateObj, shiftId: canonicalShift.id } as any,
      include: {
        nozzle: { include: { fuelType: true, dispensingUnit: true } },
        submittedByUser: { select: { id: true, fullName: true } },
      },
    })) as any[];

    const nozzleStatuses: ShiftMeterReadingStatus[] = [];
    let totalEntered = 0;
    let totalOpeningPropagated = 0;
    let totalPropagated = 0;
    let totalSalesLiters = 0;
    let hsdSalesLiters = 0;
    let pmgSalesLiters = 0;

    for (const nozzle of nozzles) {
      const openingReading = readings.find(
        (r) => r.nozzleId === nozzle.id && r.readingType === 'opening'
      );
      const closingReading = readings.find(
        (r) => r.nozzleId === nozzle.id && r.readingType === 'closing'
      );

      let openingStatus: MeterReadingStatus;
      let closingStatus: MeterReadingStatus;

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
        totalEntered++;
      } else {
        const propagated = await this.getPropagatedOpening(
          nozzle.id,
          canonicalShift,
          businessDateObj,
          branchId
        );
        if (propagated) {
          openingStatus = {
            value: propagated.value,
            status: 'propagated_backward',
            propagatedFrom: propagated.propagatedFrom,
          };
          totalOpeningPropagated++;
          totalPropagated++;
        } else {
          openingStatus = { value: null, status: 'missing' };
        }
      }

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
        totalEntered++;
      } else {
        const propagated = await this.getPropagatedClosing(
          nozzle.id,
          canonicalShift,
          businessDateObj,
          branchId
        );
        if (propagated) {
          closingStatus = {
            value: propagated.value,
            status: 'propagated_forward',
            propagatedFrom: propagated.propagatedFrom,
          };
          totalPropagated++;
        } else {
          closingStatus = { value: null, status: 'missing' };
        }
      }

      let salesLiters: number | undefined;
      if (
        openingStatus.value !== null &&
        openingStatus.value > 0 &&
        closingStatus.value !== null &&
        closingStatus.value > 0
      ) {
        salesLiters = Number(closingStatus.value) - Number(openingStatus.value);
        totalSalesLiters += salesLiters;
        if (nozzle.fuelType.code === 'HSD') {
          hsdSalesLiters += salesLiters;
        } else if (nozzle.fuelType.code === 'PMG') {
          pmgSalesLiters += salesLiters;
        }
      }

      const continuityWarning = await this.checkContinuity(
        nozzle.id,
        canonicalShift,
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

    const totalExpected = nozzles.length * 2;
    const totalFilled = totalEntered + totalOpeningPropagated;
    const totalMissing = totalExpected - totalFilled;
    const aggregateCompletion = totalExpected > 0 ? (totalFilled / totalExpected) * 100 : 0;
    const shiftSummary: ShiftSummary = {
      shiftId: canonicalShift.id,
      shiftName: canonicalShift.name || `Shift ${canonicalShift.shiftNumber}`,
      shiftNumber: canonicalShift.shiftNumber,
      startTime: canonicalShift.startTime.toISOString(),
      endTime: canonicalShift.endTime.toISOString(),
      nozzles: nozzleStatuses,
      summary: {
        totalNozzles: nozzles.length,
        totalReadingsExpected: totalExpected,
        totalReadingsEntered: totalEntered,
        totalReadingsPropagated: totalPropagated,
        openingPropagatedCount: totalOpeningPropagated,
        filledReadings: totalFilled,
        totalReadingsMissing: totalMissing,
        completionPercent: Math.round(aggregateCompletion * 100) / 100,
        totalSalesLiters: Math.round(totalSalesLiters * 1000) / 1000,
        hsdSalesLiters: Math.round(hsdSalesLiters * 1000) / 1000,
        pmgSalesLiters: Math.round(pmgSalesLiters * 1000) / 1000,
      },
    };

    return {
      businessDate,
      branchId,
      shifts: [shiftSummary],
      aggregateSummary: {
        totalShifts: 1,
        totalNozzles: nozzles.length,
        totalReadingsExpected: totalExpected,
        totalReadingsEntered: totalEntered,
        totalReadingsPropagated: totalPropagated,
        openingPropagatedCount: totalOpeningPropagated,
        filledReadings: totalFilled,
        totalReadingsMissing: totalMissing,
        completionPercent: Math.round(aggregateCompletion * 100) / 100,
        totalSalesLiters: Math.round(totalSalesLiters * 1000) / 1000,
        hsdSalesLiters: Math.round(hsdSalesLiters * 1000) / 1000,
        pmgSalesLiters: Math.round(pmgSalesLiters * 1000) / 1000,
      },
    };
  }

  /**
   * Get propagated opening reading from previous day closing
   */
  private async getPropagatedOpening(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string
  ): Promise<{ value: number; propagatedFrom: any } | null> {
    const targetDate = new Date(businessDate);
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
    const targetShift = await this.getCanonicalShift(branchId);

    const previousClosing = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'closing',
      } as any,
    });

    if (!previousClosing) return null;

    return {
      value: Number(previousClosing.meterValue),
      propagatedFrom: {
        shiftName: targetShift.name || 'Daily',
        date: targetDate.toISOString().split('T')[0],
        readingType: 'closing',
      },
    };
  }

  /**
   * Get propagated closing reading from next day opening
   */
  private async getPropagatedClosing(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string
  ): Promise<{ value: number; propagatedFrom: any } | null> {
    const targetDate = new Date(businessDate);
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    const targetShift = await this.getCanonicalShift(branchId);

    const nextOpening = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: targetDate,
        shiftId: targetShift.id,
        nozzleId,
        readingType: 'opening',
      } as any,
    });

    if (!nextOpening) return null;

    return {
      value: Number(nextOpening.meterValue),
      propagatedFrom: {
        shiftName: targetShift.name || 'Daily',
        date: targetDate.toISOString().split('T')[0],
        readingType: 'opening',
      },
    };
  }

  /**
   * Check continuity: opening reading matches previous day closing
   */
  private async checkContinuity(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    openingStatus: MeterReadingStatus
  ): Promise<string | null> {
    if (openingStatus.status !== 'entered' || openingStatus.value === null) {
      return null;
    }

    const currentOpening = openingStatus.value;
    const expectedDate = new Date(businessDate);
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);

    const branchId = shift.branchId || (await this.getBranchFromShift(shift.id));
    const expectedShift = await this.getCanonicalShift(branchId);

    const expectedReading = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: expectedDate,
        shiftId: expectedShift.id,
        nozzleId,
        readingType: 'closing',
      } as any,
    });

    if (!expectedReading) return null;

    const expectedValue = Number(expectedReading.meterValue);
    const gap = Math.abs(currentOpening - expectedValue);

    if (gap > CONTINUITY_TOLERANCE) {
      return `Gap of ${gap.toFixed(3)}L detected with ${expectedShift.name || 'Daily'} closing on ${expectedDate.toISOString().split('T')[0]}`;
    }

    return null;
  }

  /**
   * Save a single meter reading with daily auto-propagation
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

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const shift = await this.getCanonicalShift(branchId);

    const nozzle = await prisma.nozzle.findFirst({
      where: { id: input.nozzleId, dispensingUnit: { branchId } },
    });
    if (!nozzle) {
      throw new AppError(404, 'Nozzle not found');
    }

    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    const reading = await prisma.backdatedMeterReading.upsert({
      where: {
        unique_branch_date_shift_nozzle_type: {
          branchId,
          businessDate: businessDateObj,
          shiftId: shift.id,
          nozzleId: input.nozzleId,
          readingType: input.readingType,
        } as any,
      },
      create: {
        organizationId,
        branchId,
        businessDate: businessDateObj,
        shiftId: shift.id,
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
      } as any,
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
    }

    return {
      id: reading.id,
      nozzleId: reading.nozzleId,
      readingType: reading.readingType,
      meterValue: Number(reading.meterValue),
    };
  }

  /**
   * Propagate closing to next day opening (update existing if present)
   */
  private async propagateClosingToNextOpening(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string,
    meterValue: number,
    userId: string
  ): Promise<void> {
    const targetDate = new Date(businessDate);
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    const targetShift = await this.getCanonicalShift(branchId);

    await prisma.backdatedMeterReading.upsert({
      where: {
        unique_branch_date_shift_nozzle_type: {
          branchId,
          businessDate: targetDate,
          shiftId: targetShift.id,
          nozzleId,
          readingType: 'opening',
        } as any,
      },
      create: {
        organizationId: shift.organizationId,
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
      } as any,
      update: {
        meterValue: new Decimal(meterValue),
        updatedBy: userId,
        submittedBy: userId,
        submittedAt: new Date(),
      },
    });
  }

  /**
   * Propagate opening to previous day closing (update existing if present)
   */
  private async propagateOpeningToPreviousClosing(
    nozzleId: string,
    shift: any,
    businessDate: Date,
    branchId: string,
    meterValue: number,
    userId: string
  ): Promise<void> {
    const targetDate = new Date(businessDate);
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
    const targetShift = await this.getCanonicalShift(branchId);

    await prisma.backdatedMeterReading.upsert({
      where: {
        unique_branch_date_shift_nozzle_type: {
          branchId,
          businessDate: targetDate,
          shiftId: targetShift.id,
          nozzleId,
          readingType: 'closing',
        } as any,
      },
      create: {
        organizationId: shift.organizationId,
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
      } as any,
      update: {
        meterValue: new Decimal(meterValue),
        updatedBy: userId,
        submittedBy: userId,
        submittedAt: new Date(),
      },
    });
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

  /**
   * Get modal previous reading for daily chain
   */
  async getModalPreviousReading(
    branchId: string,
    businessDate: string,
    shiftId: string,
    nozzleId: string,
    readingType: 'opening' | 'closing'
  ): Promise<{ value: number | null; status: 'entered' | 'propagated' | 'not_found' } | null> {
    const shift = await this.getCanonicalShift(branchId);

    const businessDateObj = new Date(businessDate);
    businessDateObj.setUTCHours(0, 0, 0, 0);

    if (readingType === 'closing') {
      const opening = await prisma.backdatedMeterReading.findFirst({
        where: {
          branchId,
          businessDate: businessDateObj,
          shiftId: shift.id,
          nozzleId,
          readingType: 'opening',
        } as any,
      });

      if (opening) {
        return {
          value: Number(opening.meterValue),
          status: 'entered',
        };
      }

      const propagated = await this.getPropagatedOpening(
        nozzleId,
        shift,
        businessDateObj,
        branchId
      );

      if (propagated) {
        return {
          value: propagated.value,
          status: 'propagated',
        };
      }

      return { value: null, status: 'not_found' };
    }

    const previousDate = new Date(businessDateObj);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);

    const previousClosing = await prisma.backdatedMeterReading.findFirst({
      where: {
        branchId,
        businessDate: previousDate,
        shiftId: shift.id,
        nozzleId,
        readingType: 'closing',
      } as any,
    });

    if (previousClosing) {
      return {
        value: Number(previousClosing.meterValue),
        status: 'entered',
      };
    }

    return { value: null, status: 'not_found' };
  }
}

