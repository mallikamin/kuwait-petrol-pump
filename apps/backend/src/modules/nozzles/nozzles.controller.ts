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
   * Update nozzle status (activate/deactivate)
   */
  updateNozzleStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin and manager can update nozzle status
      if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { isActive } = updateNozzleStatusSchema.parse(req.body);

      const nozzle = await this.nozzlesService.updateNozzleStatus(
        id,
        req.user.organizationId,
        isActive
      );

      res.json({ nozzle, message: `Nozzle ${isActive ? 'activated' : 'deactivated'} successfully` });
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
