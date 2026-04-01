import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BranchesService } from './branches.service';

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const createDispensingUnitSchema = z.object({
  name: z.string().min(1).max(100),
  unit_number: z.number().int().positive(),
});

const createNozzleSchema = z.object({
  nozzle_number: z.number().int().positive(),
  fuel_type_id: z.string().uuid(),
  meter_type: z.enum(['digital', 'analog']).optional(),
});

export class BranchesController {
  private branchesService: BranchesService;

  constructor() {
    this.branchesService = new BranchesService();
  }

  /**
   * GET /api/branches
   * Get all branches for the authenticated user's organization
   */
  getAllBranches = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const branches = await this.branchesService.getAllBranches(req.user.organizationId);
      res.json({ branches });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/branches/:id
   * Get a single branch by ID
   */
  getBranchById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const branch = await this.branchesService.getBranchById(id, req.user.organizationId);
      res.json({ branch });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/branches/:id/dispensing-units
   * Get all dispensing units for a branch
   */
  getDispensingUnits = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const units = await this.branchesService.getDispensingUnits(id, req.user.organizationId);
      res.json({ units });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dispensing-units/:id
   * Get a single dispensing unit by ID
   */
  getDispensingUnitById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const unit = await this.branchesService.getDispensingUnitById(id, req.user.organizationId);
      res.json({ unit });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/dispensing-units/:id/nozzles
   * Get all nozzles for a dispensing unit
   */
  getNozzlesByUnit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const nozzles = await this.branchesService.getNozzlesByUnit(id, req.user.organizationId);
      res.json({ nozzles });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/branches/:id/dispensing-units
   * Create a new dispensing unit for a branch
   */
  createDispensingUnit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const data = createDispensingUnitSchema.parse(req.body);

      const unit = await this.branchesService.createDispensingUnit(
        id,
        req.user.organizationId,
        { name: data.name, unitNumber: data.unit_number }
      );

      res.status(201).json(unit);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/dispensing-units/:id/nozzles
   * Create a new nozzle for a dispensing unit
   */
  createNozzle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const data = createNozzleSchema.parse(req.body);

      const nozzle = await this.branchesService.createNozzle(
        id,
        req.user.organizationId,
        {
          nozzleNumber: data.nozzle_number,
          fuelTypeId: data.fuel_type_id,
          meterType: data.meter_type,
        }
      );

      res.status(201).json(nozzle);
    } catch (error) {
      next(error);
    }
  };
}
