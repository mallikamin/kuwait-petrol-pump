import { Request, Response, NextFunction } from 'express';
import { BackdatedMeterReadingsDailyService } from './meter-readings-daily.service';
import { AppError } from '../../middleware/error.middleware';

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
}
