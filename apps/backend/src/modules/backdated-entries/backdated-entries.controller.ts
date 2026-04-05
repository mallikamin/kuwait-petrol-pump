import { Request, Response, NextFunction } from 'express';
import { BackdatedEntriesService } from './backdated-entries.service';
import {
  createBackdatedEntrySchema,
  createBackdatedTransactionSchema,
  reconcileBackdatedEntrySchema,
} from './backdated-entries.schema';
import { hasRole } from '../../middleware/auth.middleware';
import { z } from 'zod';

const getBackdatedEntriesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  businessDateFrom: z.string().optional(), // YYYY-MM-DD
  businessDateTo: z.string().optional(), // YYYY-MM-DD
  nozzleId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  isReconciled: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

const getDailyReconciliationQuerySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string(), // YYYY-MM-DD
});

export class BackdatedEntriesController {
  private service: BackdatedEntriesService;

  constructor() {
    this.service = new BackdatedEntriesService();
  }

  /**
   * GET /api/backdated-entries
   * Get all backdated entries with filters
   */
  getAllEntries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const filters = getBackdatedEntriesQuerySchema.parse(req.query);

      const entries = await this.service.getAllEntries(filters);

      res.json({
        success: true,
        data: entries,
        total: entries.length,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/backdated-entries/:id
   * Get a single backdated entry
   */
  getEntryById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      const entry = await this.service.getEntryById(id);

      if (!entry) {
        return res.status(404).json({ error: 'Backdated entry not found' });
      }

      res.json({
        success: true,
        data: entry,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/backdated-entries
   * Create a new backdated entry (daily/nozzle anchor)
   */
  createEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions. Only admin, manager, or accountant can create backdated entries.' });
      }

      const validatedData = createBackdatedEntrySchema.parse(req.body);

      const entry = await this.service.createEntry(
        {
          branchId: validatedData.branchId,
          businessDate: validatedData.businessDate,
          nozzleId: validatedData.nozzleId,
          shiftId: validatedData.shiftId,
          openingReading: validatedData.openingReading,
          closingReading: validatedData.closingReading,
          notes: validatedData.notes,
          createdBy: req.user.userId,
        },
        req.user.organizationId
      );

      res.status(201).json({
        success: true,
        message: 'Backdated entry created successfully',
        data: entry,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/backdated-entries/:id
   * Update a backdated entry
   */
  updateEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const data = req.body;

      const entry = await this.service.updateEntry(id, data);

      res.json({
        success: true,
        message: 'Backdated entry updated successfully',
        data: entry,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/backdated-entries/:id
   * Delete a backdated entry (cascade deletes transactions)
   */
  deleteEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      await this.service.deleteEntry(id);

      res.json({
        success: true,
        message: 'Backdated entry deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/backdated-entries/:id/transactions
   * Create a transaction under a backdated entry
   */
  createTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id: backdatedEntryId } = req.params;
      const validatedData = createBackdatedTransactionSchema.parse({
        ...req.body,
        backdatedEntryId,
      });

      const transaction = await this.service.createTransaction(
        {
          backdatedEntryId: validatedData.backdatedEntryId,
          customerId: validatedData.customerId,
          vehicleNumber: validatedData.vehicleNumber,
          slipNumber: validatedData.slipNumber,
          productId: validatedData.productId,
          fuelTypeId: validatedData.fuelTypeId,
          productName: validatedData.productName,
          quantity: validatedData.quantity,
          unitPrice: validatedData.unitPrice,
          lineTotal: validatedData.lineTotal,
          paymentMethod: validatedData.paymentMethod,
          transactionDateTime: validatedData.transactionDateTime,
          notes: validatedData.notes,
          createdBy: req.user.userId,
        },
        req.user.organizationId
      );

      res.status(201).json({
        success: true,
        message: 'Transaction created successfully',
        data: transaction,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/backdated-entries/:id/transactions
   * Get all transactions for a backdated entry
   */
  getTransactions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id: backdatedEntryId } = req.params;

      const transactions = await this.service.getTransactions(backdatedEntryId);

      res.json({
        success: true,
        data: transactions,
        total: transactions.length,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/backdated-transactions/:id
   * Update a transaction
   */
  updateTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const data = req.body;

      const transaction = await this.service.updateTransaction(id, data);

      res.json({
        success: true,
        message: 'Transaction updated successfully',
        data: transaction,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/backdated-transactions/:id
   * Delete a transaction
   */
  deleteTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      await this.service.deleteTransaction(id);

      res.json({
        success: true,
        message: 'Transaction deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/backdated-entries/:id/reconcile
   * Mark a backdated entry as reconciled
   */
  reconcileEntry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const validatedData = reconcileBackdatedEntrySchema.parse({
        ...req.body,
        id,
      });

      const entry = await this.service.reconcileEntry({
        id: validatedData.id,
        isReconciled: validatedData.isReconciled,
        varianceLiters: validatedData.varianceLiters,
        varianceAmount: validatedData.varianceAmount,
      });

      res.json({
        success: true,
        message: 'Entry reconciled successfully',
        data: entry,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/backdated-entries/reconciliation/daily
   * Get daily reconciliation summary
   */
  getDailyReconciliation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'manager', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { branchId, businessDate } = getDailyReconciliationQuerySchema.parse(req.query);

      const reconciliation = await this.service.getDailyReconciliation(
        branchId,
        businessDate,
        req.user.organizationId
      );

      res.json({
        success: true,
        data: reconciliation,
      });
    } catch (error) {
      next(error);
    }
  };
}
