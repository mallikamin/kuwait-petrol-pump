import { Request, Response, NextFunction } from 'express';
import { BackdatedMeterReadingsDailyService } from './meter-readings-daily.service';
import { AppError } from '../../middleware/error.middleware';
import { hasRole } from '../../middleware/auth.middleware';

const service = new BackdatedMeterReadingsDailyService();

export class BackdatedMeterReadingsDailyController {
  /**
   * GET /api/backdated-meter-readings/daily
   *
   * Returns shift-segregated meter readings matrix for a specific business date.
   * Sources data from meter_readings + shift_instances (NOT backdated_entries).
   *
   * Query params:
   * - branchId (required): UUID
   * - businessDate (required): YYYY-MM-DD
   *
   * Response structure:
   * {
   *   businessDate: "2026-04-03",
   *   branchId: "...",
   *   shifts: [
   *     {
   *       shiftId: "...",
   *       shiftName: "Day Shift",
   *       shiftNumber: 1,
   *       startTime: "06:00:00",
   *       endTime: "18:00:00",
   *       nozzles: [
   *         {
   *           nozzleId: "...",
   *           nozzleName: "D1N1-HSD",
   *           fuelType: "HSD",
   *           fuelTypeName: "High Speed Diesel",
   *           opening: {
   *             value: 1000000,
   *             status: "entered" | "derived_from_prev_shift" | "derived_from_next_shift" | "missing"
   *             shiftInstanceId?: "...",
   *             recordedAt?: "...",
   *             imageUrl?: "..."
   *           },
   *           closing: { ... }
   *         }
   *       ]
   *     }
   *   ],
   *   summary: {
   *     totalNozzles: 6,
   *     totalReadingsExpected: 24,
   *     totalReadingsEntered: 24,
   *     totalReadingsDerived: 0,
   *     totalReadingsMissing: 0,
   *     completionPercent: 100
   *   }
   * }
   */
  async getDailyMeterReadings(req: Request, res: Response, next: NextFunction) {
    try {
      const { branchId, businessDate } = req.query;

      // Validation
      if (!branchId || typeof branchId !== 'string') {
        throw new AppError(400, 'branchId query parameter is required');
      }

      if (!businessDate || typeof businessDate !== 'string') {
        throw new AppError(400, 'businessDate query parameter is required (format: YYYY-MM-DD)');
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(businessDate)) {
        throw new AppError(400, 'businessDate must be in YYYY-MM-DD format');
      }

      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'User organization not found');
      }

      console.log('[BackdatedMeterReadingsDaily] GET request:', {
        branchId,
        businessDate,
        organizationId,
      });

      const data = await service.getDailyMeterReadings(branchId, businessDate, organizationId);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/backdated-meter-readings/daily
   *
   * Save a single meter reading for a backdated entry (shift-wise).
   *
   * Request body:
   * {
   *   branchId: string (UUID)
   *   businessDate: string (YYYY-MM-DD)
   *   shiftId: string (UUID) - REQUIRED
   *   nozzleId: string (UUID)
   *   readingType: 'opening' | 'closing'
   *   meterValue: number
   *   source?: 'manual' | 'ocr'
   *   imageUrl?: string
   *   attachmentUrl?: string
   *   ocrConfidence?: number
   *   ocrManuallyEdited?: boolean
   * }
   *
   * Response:
   * {
   *   success: true,
   *   data: {
   *     id: string,
   *     nozzleId: string,
   *     readingType: string,
   *     meterValue: number
   *   }
   * }
   */
  async saveMeterReading(req: Request, res: Response, next: NextFunction) {
    try {
      // Role check: only admin, manager, accountant can save backdated meter readings
      if (!req.user || !hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        throw new AppError(403, 'Insufficient permissions. Only admin, manager, or accountant can save meter readings.');
      }

      const { branchId, businessDate, shiftId, nozzleId, readingType, meterValue, source, imageUrl, attachmentUrl, ocrConfidence, ocrManuallyEdited } = req.body;

      // Validation
      if (!branchId || typeof branchId !== 'string') {
        throw new AppError(400, 'branchId is required');
      }

      if (!businessDate || typeof businessDate !== 'string') {
        throw new AppError(400, 'businessDate is required (format: YYYY-MM-DD)');
      }

      if (!shiftId || typeof shiftId !== 'string') {
        throw new AppError(400, 'shiftId is required');
      }

      if (!nozzleId || typeof nozzleId !== 'string') {
        throw new AppError(400, 'nozzleId is required');
      }

      if (!readingType || !['opening', 'closing'].includes(readingType)) {
        throw new AppError(400, 'readingType must be "opening" or "closing"');
      }

      if (typeof meterValue !== 'number' || meterValue < 0) {
        throw new AppError(400, 'meterValue must be a non-negative number');
      }

      const organizationId = req.user.organizationId;
      const userId = req.user.userId;

      if (!organizationId || !userId) {
        throw new AppError(401, 'User organization/id not found');
      }

      const data = await service.saveSingleMeterReading(
        branchId,
        businessDate,
        shiftId,
        organizationId,
        {
          nozzleId,
          readingType,
          meterValue,
          source: source as 'manual' | 'ocr' | undefined,
          imageUrl,
          attachmentUrl,
          ocrConfidence,
          ocrManuallyEdited,
        },
        userId
      );

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/backdated-meter-readings/daily/:readingId
   *
   * Update a meter reading (partial update).
   *
   * Request body:
   * {
   *   meterValue?: number
   *   attachmentUrl?: string
   *   ocrManuallyEdited?: boolean
   * }
   *
   * Response:
   * {
   *   success: true,
   *   data: {
   *     id: string,
   *     meterValue: number
   *   }
   * }
   */
  async updateMeterReading(req: Request, res: Response, next: NextFunction) {
    try {
      // Role check: only admin, manager, accountant can update backdated meter readings
      if (!req.user || !hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        throw new AppError(403, 'Insufficient permissions. Only admin, manager, or accountant can update meter readings.');
      }

      const { readingId } = req.params;
      const { meterValue, attachmentUrl, ocrManuallyEdited } = req.body;

      if (!readingId || typeof readingId !== 'string') {
        throw new AppError(400, 'readingId is required');
      }

      const organizationId = req.user.organizationId;
      const userId = req.user.userId;

      if (!organizationId || !userId) {
        throw new AppError(401, 'User organization/id not found');
      }

      const data = await service.updateMeterReading(
        readingId,
        organizationId,
        {
          meterValue: typeof meterValue === 'number' ? meterValue : undefined,
          attachmentUrl,
          ocrManuallyEdited,
        },
        userId
      );

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/backdated-meter-readings/daily/:readingId
   *
   * Delete a single meter reading.
   *
   * Response:
   * {
   *   success: true,
   *   message: "Meter reading deleted"
   * }
   */
  async deleteMeterReading(req: Request, res: Response, next: NextFunction) {
    try {
      // Role check: only admin, manager, accountant can delete backdated meter readings
      if (!req.user || !hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        throw new AppError(403, 'Insufficient permissions. Only admin, manager, or accountant can delete meter readings.');
      }

      const { readingId } = req.params;

      if (!readingId || typeof readingId !== 'string') {
        throw new AppError(400, 'readingId is required');
      }

      const organizationId = req.user.organizationId;

      if (!organizationId) {
        throw new AppError(401, 'User organization not found');
      }

      await service.deleteMeterReading(readingId, organizationId);

      res.json({
        success: true,
        message: 'Meter reading deleted',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/backdated-meter-readings/daily/modal/previous-reading
   *
   * Get previous reading for modal display (shift-aware context).
   * For CLOSING: returns current shift OPENING value (entered or propagated)
   * For OPENING: returns previous shift CLOSING (same day) or previous day last shift closing
   *
   * Query params:
   * - branchId (required): UUID
   * - businessDate (required): YYYY-MM-DD
   * - shiftId (required): UUID
   * - nozzleId (required): UUID
   * - readingType (required): 'opening' | 'closing'
   */
  async getModalPreviousReading(req: Request, res: Response, next: NextFunction) {
    try {
      const { branchId, businessDate, shiftId, nozzleId, readingType } = req.query;

      // Validation
      if (!branchId || typeof branchId !== 'string') {
        throw new AppError(400, 'branchId is required');
      }

      if (!businessDate || typeof businessDate !== 'string') {
        throw new AppError(400, 'businessDate is required (YYYY-MM-DD)');
      }

      if (!shiftId || typeof shiftId !== 'string') {
        throw new AppError(400, 'shiftId is required');
      }

      if (!nozzleId || typeof nozzleId !== 'string') {
        throw new AppError(400, 'nozzleId is required');
      }

      if (!readingType || !['opening', 'closing'].includes(readingType as string)) {
        throw new AppError(400, 'readingType must be "opening" or "closing"');
      }

      const result = await service.getModalPreviousReading(
        branchId,
        businessDate,
        shiftId,
        nozzleId,
        readingType as 'opening' | 'closing'
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
