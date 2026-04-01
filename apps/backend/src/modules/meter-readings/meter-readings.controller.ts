import { Request, Response, NextFunction } from 'express';
import { MeterReadingsService } from './meter-readings.service';
import { hasRole } from '../../middleware/auth.middleware';
import {
  createMeterReadingSchema,
  verifyReadingSchema,
  idParamSchema,
  nozzleIdParamSchema,
  shiftIdParamSchema,
  CreateMeterReadingInput,
} from './meter-readings.schema';

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
      if (!hasRole(req.user, ['admin', 'manager', 'operator', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data: CreateMeterReadingInput = createMeterReadingSchema.parse(req.body);

      const meterReading = await this.meterReadingsService.createMeterReading(
        data,
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
   * GET /api/meter-readings
   * Get all meter readings for the organization
   */
  getAllReadings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const size = req.query.size ? parseInt(req.query.size as string) : 20;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : size;
      const isOcr = req.query.is_ocr ? req.query.is_ocr === 'true' : undefined;

      const allReadings = await this.meterReadingsService.getAllReadings(
        req.user.organizationId,
        limit * page, // Get enough for pagination
        isOcr
      );

      // Paginate
      const startIndex = (page - 1) * size;
      const endIndex = startIndex + size;
      const paginatedReadings = allReadings.slice(startIndex, endIndex);

      // Transform to snake_case for mobile app compatibility
      const transformedReadings = paginatedReadings.map((reading) => ({
        id: reading.id,
        nozzle_id: reading.nozzleId,
        nozzle: reading.nozzle ? {
          id: reading.nozzle.id,
          nozzle_number: reading.nozzle.nozzleNumber,
          fuel_type: reading.nozzle.fuelType ? {
            id: reading.nozzle.fuelType.id,
            name: reading.nozzle.fuelType.name,
            code: reading.nozzle.fuelType.code,
          } : null,
        } : null,
        shift_id: reading.shiftInstanceId,
        reading_type: reading.readingType,
        reading_value: parseFloat(reading.meterValue.toString()),
        meter_value: parseFloat(reading.meterValue.toString()),
        image_url: reading.imageUrl,
        is_ocr: reading.isOcr,
        is_verified: !reading.isManualOverride && reading.meterValue !== null,
        ocr_confidence: reading.ocrConfidence,
        created_by_id: reading.recordedBy,
        created_by: reading.recordedByUser ? {
          id: reading.recordedByUser.id,
          full_name: reading.recordedByUser.fullName,
          username: reading.recordedByUser.username,
        } : null,
        created_at: reading.recordedAt.toISOString(),
        recorded_at: reading.recordedAt.toISOString(),
        variance: null, // Not calculated in list view
      }));

      // Return in expected format with pagination metadata
      res.json({
        readings: transformedReadings,
        total: allReadings.length,
        page,
        size,
        pages: Math.ceil(allReadings.length / size),
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
      if (!hasRole(req.user, ['admin', 'manager'])) {
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
