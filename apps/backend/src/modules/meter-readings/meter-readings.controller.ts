import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MeterReadingsService } from './meter-readings.service';

const createMeterReadingSchema = z.object({
  nozzleId: z.string().uuid(),
  shiftInstanceId: z.string().uuid(),
  readingType: z.enum(['opening', 'closing']),
  meterValue: z.number().positive(),
  imageUrl: z.string().url().optional(),
  ocrResult: z.number().positive().optional(),
  isManualOverride: z.boolean().default(false),
});

const verifyReadingSchema = z.object({
  verifiedValue: z.number().positive(),
  isManualOverride: z.boolean(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const nozzleIdParamSchema = z.object({
  nozzleId: z.string().uuid(),
});

const shiftIdParamSchema = z.object({
  shiftId: z.string().uuid(),
});

export class MeterReadingsController {
  private meterReadingsService: MeterReadingsService;

  constructor() {
    this.meterReadingsService = new MeterReadingsService();
  }

  /**
   * POST /api/meter-readings
   * Create a new meter reading (with OCR support)
   */
  createMeterReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only operator, cashier, manager can record meter readings
      if (!['admin', 'manager', 'operator', 'cashier'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createMeterReadingSchema.parse(req.body);

      const meterReading = await this.meterReadingsService.createMeterReading(
        data as any,
        req.user.userId,
        req.user.organizationId
      );

      res.status(201).json({
        meterReading,
        message: 'Meter reading recorded successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/meter-readings/:nozzleId/latest
   * Get the latest meter reading for a nozzle
   */
  getLatestReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { nozzleId } = nozzleIdParamSchema.parse(req.params);

      const reading = await this.meterReadingsService.getLatestReading(
        nozzleId,
        req.user.organizationId
      );

      res.json({ reading });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/meter-readings/:id/verify
   * Verify or manually correct a meter reading
   */
  verifyReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only manager can verify/correct readings
      if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { verifiedValue, isManualOverride } = verifyReadingSchema.parse(req.body);

      const reading = await this.meterReadingsService.verifyReading(
        id,
        req.user.organizationId,
        verifiedValue,
        isManualOverride
      );

      res.json({
        reading,
        message: 'Meter reading verified successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/meter-readings/shift/:shiftId
   * Get all meter readings for a shift
   */
  getReadingsByShift = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { shiftId } = shiftIdParamSchema.parse(req.params);

      const readings = await this.meterReadingsService.getReadingsByShift(
        shiftId,
        req.user.organizationId
      );

      res.json({ readings });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/meter-readings/shift/:shiftId/variance
   * Get meter reading variance report for a shift
   */
  getVarianceReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { shiftId } = shiftIdParamSchema.parse(req.params);

      const report = await this.meterReadingsService.getVarianceReport(
        shiftId,
        req.user.organizationId
      );

      res.json(report);
    } catch (error) {
      next(error);
    }
  };
}
