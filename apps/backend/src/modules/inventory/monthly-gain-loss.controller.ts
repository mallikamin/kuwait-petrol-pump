import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MonthlyGainLossService } from './monthly-gain-loss.service';

const createEntrySchema = z.object({
  branchId: z.string().uuid(),
  fuelTypeId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format (YYYY-MM)'),
  quantity: z.number().finite(),
  remarks: z.string().optional(),
});

const getEntriesSchema = z.object({
  branchId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  fuelTypeId: z.string().uuid().optional(),
});

const getMonthSummarySchema = z.object({
  branchId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export class MonthlyGainLossController {
  private service: MonthlyGainLossService;

  constructor() {
    this.service = new MonthlyGainLossService();
  }

  createEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { branchId, fuelTypeId, month, quantity, remarks } =
        createEntrySchema.parse(req.body);

      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const result = await this.service.createEntry({
        branchId,
        fuelTypeId,
        month,
        quantity,
        remarks,
        recordedBy: req.user.userId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getEntries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { branchId, month, fuelTypeId } = getEntriesSchema.parse(
        req.query
      );

      const entries = await this.service.getEntries({
        branchId,
        month,
        fuelTypeId,
      });

      res.json({
        entries,
        count: entries.length,
      });
    } catch (error) {
      next(error);
    }
  };

  getEntryById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const entry = await this.service.getEntryById(id);
      res.json(entry);
    } catch (error) {
      next(error);
    }
  };

  deleteEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const result = await this.service.deleteEntry(id, req.user.userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getMonthSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { branchId, month } = getMonthSummarySchema.parse(req.query);

      const summary = await this.service.getMonthSummary({
        branchId,
        month,
      });

      res.json({
        month,
        branchId,
        summary,
        totalFuelTypes: summary.length,
      });
    } catch (error) {
      next(error);
    }
  };
}
