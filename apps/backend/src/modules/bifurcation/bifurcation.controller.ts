import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BifurcationService } from './bifurcation.service';

const createBifurcationSchema = z.object({
  branchId: z.string().uuid(),
  date: z.string().datetime().transform(val => new Date(val)),
  shiftInstanceId: z.string().uuid().optional(),
  pmgTotalLiters: z.number().nonnegative().optional(),
  pmgTotalAmount: z.number().nonnegative().optional(),
  hsdTotalLiters: z.number().nonnegative().optional(),
  hsdTotalAmount: z.number().nonnegative().optional(),
  cashAmount: z.number().nonnegative().optional(),
  creditAmount: z.number().nonnegative().optional(),
  cardAmount: z.number().nonnegative().optional(),
  psoCardAmount: z.number().nonnegative().optional(),
  expectedTotal: z.number().optional(),
  actualTotal: z.number().nonnegative(),
  varianceNotes: z.string().optional(),
});

const getBifurcationByDateSchema = z.object({
  branchId: z.string().uuid().optional(),
  date: z.string().datetime().transform(val => new Date(val)),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const getBifurcationHistorySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  status: z.enum(['pending', 'completed', 'verified']).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

const getPendingBifurcationsSchema = z.object({
  branchId: z.string().uuid(),
});

export class BifurcationController {
  private bifurcationService: BifurcationService;

  constructor() {
    this.bifurcationService = new BifurcationService();
  }

  /**
   * POST /api/bifurcation
   * Create a bifurcation record for daily sales reconciliation
   */
  createBifurcation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only manager and accountant can create bifurcations
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createBifurcationSchema.parse(req.body);

      const bifurcation = await this.bifurcationService.createBifurcation(
        data,
        req.user.userId,
        req.user.organizationId
      );

      res.status(201).json({
        bifurcation,
        message: 'Bifurcation record created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/bifurcation/:date
   * Get bifurcation for a specific date
   * Query params: branchId (required)
   */
  getBifurcationByDate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const dateParam = req.params.date;
      const branchId = req.query.branchId as string | undefined;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId query parameter is required' });
      }

      // Validate date format
      if (!dateParam || isNaN(Date.parse(dateParam))) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      const bifurcation = await this.bifurcationService.getBifurcationByDate(
        branchId,
        new Date(dateParam),
        req.user.organizationId
      );

      res.json({ bifurcation });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/bifurcation/:id/verify
   * Verify a bifurcation record (mark as verified)
   */
  verifyBifurcation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only manager and accountant can verify bifurcations
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);

      const bifurcation = await this.bifurcationService.verifyBifurcation(
        id,
        req.user.organizationId
      );

      res.json({
        bifurcation,
        message: 'Bifurcation verified successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/bifurcation/pending
   * Get pending bifurcations for a branch
   * Query params: branchId (required)
   */
  getPendingBifurcations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const branchId = req.query.branchId as string | undefined;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId query parameter is required' });
      }

      const bifurcations = await this.bifurcationService.getPendingBifurcations(
        branchId,
        req.user.organizationId
      );

      res.json({ bifurcations });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/bifurcation/history
   * Get bifurcation history with filters
   * Query params: branchId (required), startDate, endDate, status, limit, offset
   */
  getBifurcationHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const branchId = req.query.branchId as string | undefined;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId query parameter is required' });
      }

      const filters = {
        branchId,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        status: (req.query.status as 'pending' | 'completed' | 'verified' | undefined),
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      };

      const result = await this.bifurcationService.getBifurcationHistory(
        branchId,
        req.user.organizationId,
        {
          startDate: filters.startDate,
          endDate: filters.endDate,
          status: filters.status,
          limit: filters.limit,
          offset: filters.offset,
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/bifurcation/:id
   * Get bifurcation by ID
   */
  getBifurcationById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const bifurcation = await this.bifurcationService.getBifurcationById(
        id,
        req.user.organizationId
      );

      res.json({ bifurcation });
    } catch (error) {
      next(error);
    }
  };
}
