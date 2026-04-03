import { Request, Response, NextFunction } from 'express';
import { BackdatedEntriesService } from './backdated-entries.service';
import { createBackdatedEntrySchema } from './backdated-entries.schema';
import { hasRole } from '../../middleware/auth.middleware';
import { z } from 'zod';

const getBackdatedEntriesQuerySchema = z.object({
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
});

export class BackdatedEntriesController {
  private service: BackdatedEntriesService;

  constructor() {
    this.service = new BackdatedEntriesService();
  }

  /**
   * POST /api/backdated-entries
   * Create a backdated entry (meter readings + bifurcation)
   */
  createBackdatedEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin, manager, and accountant can create backdated entries
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions. Only admin, manager, or accountant can create backdated entries.' });
      }

      const data = createBackdatedEntrySchema.parse(req.body);

      const result = await this.service.createBackdatedEntry(
        data,
        req.user.userId,
        req.user.organizationId
      );

      res.status(201).json({
        message: 'Backdated entry created successfully',
        entry: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/backdated-entries
   * Get backdated entries summary
   */
  getBackdatedEntries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin, manager, and accountant can view backdated entries
      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { startDate, endDate, limit } = getBackdatedEntriesQuerySchema.parse(req.query);

      const entries = await this.service.getBackdatedEntries(
        req.user.organizationId,
        startDate,
        endDate,
        limit
      );

      res.json({
        items: entries,
        total: entries.length,
      });
    } catch (error) {
      next(error);
    }
  };
}
