import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NozzlesService } from './nozzles.service';

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const getNozzlesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  dispensingUnitId: z.string().uuid().optional(),
  fuelTypeId: z.string().uuid().optional(),
  isActive: z.string().transform(val => val === 'true').optional(),
});

const updateNozzleStatusSchema = z.object({
  isActive: z.boolean(),
});

const updateNozzleSchema = z.object({
  nozzle_number: z.number().int().positive().optional(),
  fuel_type_id: z.string().uuid().optional(),
  meter_type: z.enum(['digital', 'analog']).optional(),
  is_active: z.boolean().optional(),
});

export class NozzlesController {
  private nozzlesService: NozzlesService;

  constructor() {
    this.nozzlesService = new NozzlesService();
  }

  /**
   * GET /api/nozzles
   * Get all nozzles with optional filters
   */
  getAllNozzles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const filters = getNozzlesQuerySchema.parse(req.query);
      const nozzles = await this.nozzlesService.getAllNozzles(req.user.organizationId, filters);
      res.json({ nozzles });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/nozzles/:id
   * Get a single nozzle by ID
   */
  getNozzleById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const nozzle = await this.nozzlesService.getNozzleById(id, req.user.organizationId);
      res.json({ nozzle });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/nozzles/:id
   * Update nozzle (status, number, fuel type, meter type)
   */
  updateNozzleStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin and manager can update nozzle
      if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);

      // Try new schema first (full update), fallback to old schema (status only)
      let data: any;
      try {
        data = updateNozzleSchema.parse(req.body);
      } catch {
        const { isActive } = updateNozzleStatusSchema.parse(req.body);
        data = { is_active: isActive };
      }

      // Convert snake_case to camelCase for service
      const updateData: any = {};
      if (data.nozzle_number !== undefined) updateData.nozzleNumber = data.nozzle_number;
      if (data.fuel_type_id !== undefined) updateData.fuelTypeId = data.fuel_type_id;
      if (data.meter_type !== undefined) updateData.meterType = data.meter_type;
      if (data.is_active !== undefined) updateData.isActive = data.is_active;

      const nozzle = await this.nozzlesService.updateNozzle(
        id,
        req.user.organizationId,
        updateData
      );

      res.json(nozzle);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/nozzles/:id/latest-reading
   * Get latest meter reading for a nozzle
   */
  getLatestReading = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const reading = await this.nozzlesService.getLatestReading(id, req.user.organizationId);

      res.json({ reading });
    } catch (error) {
      next(error);
    }
  };
}
