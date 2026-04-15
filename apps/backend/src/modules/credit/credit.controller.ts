import { Request, Response, NextFunction } from 'express';
import { CreditService } from './credit.service';
import {
  createReceiptSchema,
  updateReceiptSchema,
  getReceiptsQuerySchema,
  getCustomerLedgerQuerySchema,
  checkCreditLimitQuerySchema,
  getPartyPositionQuerySchema,
  exportReportQuerySchema,
  setBranchLimitSchema,
} from './credit.schema';
import { hasRole } from '../../middleware/auth.middleware';

export class CreditController {
  private service: CreditService;

  constructor() {
    this.service = new CreditService();
  }

  // ============================================================
  // Receipt Operations
  // ============================================================

  /**
   * POST /api/credit/receipts
   * Create a new receipt with allocations
   */
  createReceipt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createReceiptSchema.parse(req.body);

      const receipt = await this.service.createReceipt(
        req.user.organizationId,
        req.user.userId,
        data
      );

      res.status(201).json({
        success: true,
        data: receipt,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/credit/receipts/:id
   * Update an existing receipt (replace allocations)
   */
  updateReceipt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const data = updateReceiptSchema.parse(req.body);

      const receipt = await this.service.updateReceipt(
        id,
        req.user.organizationId,
        req.user.userId,
        data
      );

      res.json({
        success: true,
        data: receipt,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/credit/receipts/:id
   * Soft delete a receipt
   */
  deleteReceipt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      await this.service.deleteReceipt(id, req.user.organizationId, req.user.userId);

      res.json({
        success: true,
        message: 'Receipt deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/receipts
   * List receipts with filters
   */
  getReceipts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const filters = getReceiptsQuerySchema.parse(req.query);

      // TODO: Implement list receipts query
      res.json({
        success: true,
        data: [],
        message: 'List receipts endpoint - TODO',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/receipts/:id
   * Get receipt detail with allocations
   */
  getReceiptById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      // TODO: Implement get receipt by ID
      res.json({
        success: true,
        data: null,
        message: 'Get receipt by ID endpoint - TODO',
      });
    } catch (error) {
      next(error);
    }
  };

  // ============================================================
  // Ledger & Balance
  // ============================================================

  /**
   * GET /api/credit/customers/:id/ledger
   * Get customer ledger with running balance
   */
  getCustomerLedger = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant', 'manager', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const filters = getCustomerLedgerQuerySchema.parse(req.query);

      const ledger = await this.service.getCustomerLedger(id, filters);

      res.json({
        success: true,
        data: ledger,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/customers/:id/balance
   * Get customer balance with credit limit info
   */
  getCustomerBalance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant', 'manager', 'cashier'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const branchId = req.query.branchId as string | undefined;

      const balance = await this.service.getCustomerBalance(id, branchId);

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/customers/:id/open-invoices
   * Get open invoices for manual allocation
   */
  getOpenInvoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      const invoices = await this.service.getOpenInvoices(id);

      res.json({
        success: true,
        data: invoices,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/check-limit
   * Credit limit soft warning check
   */
  checkCreditLimit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { customerId, branchId, amount } = checkCreditLimitQuerySchema.parse(req.query);

      const result = await this.service.checkCreditLimit(customerId, branchId, amount);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ============================================================
  // Reporting
  // ============================================================

  /**
   * GET /api/credit/report/party-position
   * Party position report (all customers with balances)
   */
  getPartyPositionReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant', 'manager'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const filters = getPartyPositionQuerySchema.parse(req.query);

      const report = await this.service.getPartyPositionReport(req.user.organizationId, filters);

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/report/export
   * Export report as PDF/CSV/Excel
   */
  exportReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant', 'manager'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const filters = exportReportQuerySchema.parse(req.query);

      // TODO: Implement export functionality
      res.json({
        success: true,
        message: 'Export endpoint - TODO',
      });
    } catch (error) {
      next(error);
    }
  };

  // ============================================================
  // Credit Limits
  // ============================================================

  /**
   * PUT /api/credit/customers/:id/branch-limit
   * Set or update branch-specific credit limit
   */
  setBranchLimit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const data = setBranchLimitSchema.parse(req.body);

      const limit = await this.service.setBranchLimit(
        req.user.organizationId,
        id,
        data.branchId,
        data.creditLimit,
        data.creditDays
      );

      res.json({
        success: true,
        data: limit,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/credit/customers/:id/branch-limits
   * Get all branch limits for a customer
   */
  getBranchLimits = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!hasRole(req.user, ['admin', 'accountant'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = req.params;

      const limits = await this.service.getBranchLimits(id);

      res.json({
        success: true,
        data: limits,
      });
    } catch (error) {
      next(error);
    }
  };
}
