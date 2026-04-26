import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MonthlyGainLossService } from './monthly-gain-loss.service';
import { computeStockAtDate } from './stock-at-date.service';

const createEntrySchema = z.object({
  branchId: z.string().uuid(),
  fuelTypeId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format (YYYY-MM)'),
  quantity: z.number().finite(),
  remarks: z.string().optional(),
});

const createByDateSchema = z
  .object({
    branchId: z.string().uuid(),
    fuelTypeId: z.string().uuid(),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)'),
    measuredQty: z.number().finite().optional(),
    quantity: z.number().finite().optional(),
    remarks: z.string().optional(),
  })
  .refine((d) => d.measuredQty !== undefined || d.quantity !== undefined, {
    message: 'Provide either measuredQty or quantity',
  });

const getEntriesSchema = z.object({
  branchId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fuelTypeId: z.string().uuid().optional(),
});

const getMonthSummarySchema = z.object({
  branchId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const stockAtDateSchema = z.object({
  branchId: z.string().uuid(),
  fuelTypeId: z.string().uuid(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateEntrySchema = z.object({
  measuredQty: z.number().finite().nullable().optional(),
  quantity: z.number().finite().optional(),
  remarks: z.string().nullable().optional(),
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
        organizationId: req.user.organizationId,
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

  /** New date-keyed creation flow (Gain/Loss page). */
  createByDate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createByDateSchema.parse(req.body);
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

      const result = await this.service.createByDate({
        organizationId: req.user.organizationId,
        branchId: parsed.branchId,
        fuelTypeId: parsed.fuelTypeId,
        businessDate: parsed.businessDate,
        measuredQty: parsed.measuredQty,
        quantity: parsed.quantity,
        remarks: parsed.remarks,
        recordedBy: req.user.userId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getEntries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const { branchId, month, startDate, endDate, fuelTypeId } =
        getEntriesSchema.parse(req.query);

      const entries = await this.service.getEntries({
        organizationId: req.user.organizationId,
        branchId,
        month,
        startDate,
        endDate,
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
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const { id } = req.params;

      const entry = await this.service.getEntryById(id, req.user.organizationId);
      res.json(entry);
    } catch (error) {
      next(error);
    }
  };

  updateEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = updateEntrySchema.parse(req.body);
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

      const result = await this.service.updateEntry(
        id,
        parsed,
        req.user.userId,
        req.user.role,
        req.user.organizationId,
      );
      res.json(result);
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

      const result = await this.service.deleteEntry(
        id,
        req.user.userId,
        req.user.role,
        req.user.organizationId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getMonthSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const { branchId, month } = getMonthSummarySchema.parse(req.query);

      const summary = await this.service.getMonthSummary({
        organizationId: req.user.organizationId,
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

  /** GET /api/inventory/monthly-gain-loss/stock-at-date — drives the
   *  auto-calc UI. Returns book stock + lastPurchaseRate at a given date. */
  stockAtDate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const { branchId, fuelTypeId, asOfDate } = stockAtDateSchema.parse(req.query);
      const result = await computeStockAtDate({
        organizationId: req.user.organizationId,
        branchId,
        fuelTypeId,
        asOfDate,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
