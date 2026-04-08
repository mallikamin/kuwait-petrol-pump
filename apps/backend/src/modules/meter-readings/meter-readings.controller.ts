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

      // Validate schema
      let data: CreateMeterReadingInput;
      try {
        data = createMeterReadingSchema.parse(req.body);
      } catch (validationError: any) {
        // Return detailed validation error for debugging
        return res.status(400).json({
          error: 'Validation failed',
          details: validationError.errors || validationError.message,
          received_keys: Object.keys(req.body),
          attachment_url_length: req.body.attachmentUrl ? req.body.attachmentUrl.length : 0,
        });
      }

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
   *
   * Query params:
   * - page: Page number (default: 1)
   * - size: Page size (default: 20)
   * - is_ocr: Filter by OCR readings (optional)
   * - date: Filter by business date YYYY-MM-DD (optional) - filters by shift_instance.date
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
      const businessDate = req.query.date as string | undefined; // YYYY-MM-DD format
      const nozzleId = req.query.nozzle_id as string | undefined;
      const shiftInstanceId = req.query.shift_id as string | undefined;
      const readingType = req.query.reading_type as 'opening' | 'closing' | undefined;

      const allReadings = await this.meterReadingsService.getAllReadings(
        req.user.organizationId,
        limit * page, // Get enough for pagination
        isOcr,
        businessDate, // Pass business date filter
        nozzleId,
        shiftInstanceId,
        readingType
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
          name: reading.nozzle.name || null,
          nozzle_number: reading.nozzle.nozzleNumber,
          dispensing_unit: reading.nozzle.dispensingUnit ? {
            id: reading.nozzle.dispensingUnit.id,
            unit_number: reading.nozzle.dispensingUnit.unitNumber,
            name: reading.nozzle.dispensingUnit.name || null,
          } : null,
          fuel_type: reading.nozzle.fuelType ? {
            id: reading.nozzle.fuelType.id,
            name: reading.nozzle.fuelType.name,
            code: reading.nozzle.fuelType.code,
          } : null,
        } : null,
        shift_id: reading.shiftInstanceId,
        shift_instance: reading.shiftInstance ? {
          id: reading.shiftInstance.id,
          date: reading.shiftInstance.date,
          status: reading.shiftInstance.status,
          opened_at: reading.shiftInstance.openedAt?.toISOString() || null,
          closed_at: reading.shiftInstance.closedAt?.toISOString() || null,
          opened_by: (reading.shiftInstance as any).openedByUser ? {
            full_name: (reading.shiftInstance as any).openedByUser.fullName,
            username: (reading.shiftInstance as any).openedByUser.username,
          } : null,
          shift: reading.shiftInstance.shift ? {
            id: reading.shiftInstance.shift.id,
            name: reading.shiftInstance.shift.name || null,
            shift_number: reading.shiftInstance.shift.shiftNumber,
            start_time: reading.shiftInstance.shift.startTime?.toISOString() || null,
            end_time: reading.shiftInstance.shift.endTime?.toISOString() || null,
          } : null,
        } : null,
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
        // Audit metadata for backdated submissions
        submitted_by: (reading as any).submittedBy,
        submitted_by_name: (reading as any).submittedByUser ? (reading as any).submittedByUser.fullName : null,
        submitted_at: (reading as any).submittedAt ? (reading as any).submittedAt.toISOString() : null,
        attachment_url: (reading as any).attachmentUrl,
        ocr_manually_edited: (reading as any).ocrManuallyEdited || false,
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

  /**
   * PATCH /api/meter-readings/:id
   * Update meter reading value (for correcting mistakes)
   */
  updateMeterReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin, manager, or operator can update readings
      if (!hasRole(req.user, ['admin', 'manager', 'operator'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { meterValue, attachmentUrl, ocrManuallyEdited } = req.body;

      if (!meterValue || typeof meterValue !== 'number') {
        return res.status(400).json({ error: 'meterValue is required and must be a number' });
      }

      const updatedReading = await this.meterReadingsService.updateMeterReading(
        id,
        meterValue,
        req.user.userId,
        req.user.organizationId,
        attachmentUrl,
        ocrManuallyEdited
      );

      res.json({
        meterReading: updatedReading,
        message: 'Meter reading updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/meter-readings/:id
   * Delete a meter reading (for removing wrong entries)
   */
  deleteMeterReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin or manager can delete readings
      if (!hasRole(req.user, ['admin', 'manager'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);

      await this.meterReadingsService.deleteMeterReading(
        id,
        req.user.userId,
        req.user.organizationId
      );

      res.json({
        success: true,
        message: 'Meter reading deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
