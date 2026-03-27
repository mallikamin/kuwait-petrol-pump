import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ShiftsService } from './shifts.service';

const openShiftSchema = z.object({
  branchId: z.string().uuid(),
  shiftId: z.string().uuid(),
});

const closeShiftSchema = z.object({
  notes: z.string().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const getCurrentShiftQuerySchema = z.object({
  branchId: z.string().uuid(),
});

const getHistoryQuerySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  status: z.enum(['pending', 'open', 'closed']).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

export class ShiftsController {
  private shiftsService: ShiftsService;

  constructor() {
    this.shiftsService = new ShiftsService();
  }

  /**
   * POST /api/shifts/open
   * Open a new shift
   */
  openShift = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only manager, cashier, and operator can open shifts
      if (!['admin', 'manager', 'cashier', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { branchId, shiftId } = openShiftSchema.parse(req.body);

      const shiftInstance = await this.shiftsService.openShift(
        branchId,
        shiftId,
        req.user.userId,
        req.user.organizationId
      );

      res.status(201).json({
        shiftInstance,
        message: 'Shift opened successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/shifts/:id/close
   * Close a shift
   */
  closeShift = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only manager, cashier, and operator can close shifts
      if (!['admin', 'manager', 'cashier', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);
      const { notes } = closeShiftSchema.parse(req.body);

      const shiftInstance = await this.shiftsService.closeShift(
        id,
        req.user.userId,
        req.user.organizationId,
        notes
      );

      res.json({
        shiftInstance,
        message: 'Shift closed successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/shifts/current
   * Get current active shift for a branch
   */
  getCurrentShift = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { branchId } = getCurrentShiftQuerySchema.parse(req.query);

      const currentShift = await this.shiftsService.getCurrentShift(branchId, req.user.organizationId);

      if (!currentShift) {
        return res.json({ currentShift: null, message: 'No active shift found' });
      }

      res.json({ currentShift });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/shifts/history
   * Get shift history with filters
   */
  getShiftHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const filters = getHistoryQuerySchema.parse(req.query);

      const result = await this.shiftsService.getShiftHistory(
        filters.branchId,
        req.user.organizationId,
        filters
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/shifts/:id
   * Get shift by ID
   */
  getShiftById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const shiftInstance = await this.shiftsService.getShiftById(id, req.user.organizationId);

      res.json({ shiftInstance });
    } catch (error) {
      next(error);
    }
  };
}
