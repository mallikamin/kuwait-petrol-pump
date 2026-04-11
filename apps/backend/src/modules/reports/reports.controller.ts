import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReportsService } from './reports.service';

// Validation schemas
const dateString = z.string().transform(val => new Date(val)).refine(d => !isNaN(d.getTime()), { message: 'Invalid date' });

const dailySalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: dateString,
});

const shiftReportQuerySchema = z.object({
  shiftInstanceId: z.string().uuid(),
});

const varianceReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  startDate: dateString,
  endDate: dateString,
});

const customerLedgerQuerySchema = z.object({
  customerId: z.string().uuid(),
  startDate: dateString,
  endDate: dateString,
});

const inventoryReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  asOfDate: z.string().optional(), // ISO date string for snapshot as-of-date (single date)
  startDate: z.string().optional(), // ISO date string for range start
  endDate: z.string().optional(), // ISO date string for range end
});

const fuelPriceHistoryQuerySchema = z.object({
  startDate: dateString,
  endDate: dateString,
});

const customerWiseSalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  startDate: dateString,
  endDate: dateString,
  customerId: z.string().uuid().optional(),
});

export class ReportsController {
  private reportsService: ReportsService;

  constructor() {
    this.reportsService = new ReportsService();
  }

  /**
   * GET /api/reports/daily-sales
   * Get daily sales report with breakdown
   */
  getDailySalesReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers, accountants, and operators can access reports
      if (!['admin', 'manager', 'accountant', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = dailySalesQuerySchema.parse(req.query);

      // Use user's branch if not specified (for cashiers/operators)
      // Managers/accountants can specify any branch
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      const report = await this.reportsService.getDailySalesReport(
        branchId,
        query.date,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Daily sales report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/shift
   * Get detailed shift report
   */
  getShiftReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const query = shiftReportQuerySchema.parse(req.query);

      // Allow managers, accountants, and operators to view shift reports
      const canViewAllReports = ['admin', 'manager', 'accountant', 'operator'].includes(req.user.role);

      if (!canViewAllReports) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const report = await this.reportsService.getShiftReport(
        query.shiftInstanceId,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Shift report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/variance
   * Get variance report for meter readings
   */
  getVarianceReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers, accountants, and operators can access variance reports
      if (!['admin', 'manager', 'accountant', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = varianceReportQuerySchema.parse(req.query);

      // Validate date range
      if (query.startDate > query.endDate) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }

      // Use user's branch if not specified
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      const report = await this.reportsService.getVarianceReport(
        branchId,
        query.startDate,
        query.endDate,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Variance report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/customer-ledger
   * Get customer transaction history and ledger
   */
  getCustomerLedgerReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers and accountants can access customer ledger reports
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = customerLedgerQuerySchema.parse(req.query);

      // Validate date range
      if (query.startDate > query.endDate) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }

      const report = await this.reportsService.getCustomerLedgerReport(
        query.customerId,
        query.startDate,
        query.endDate,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Customer ledger report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/inventory
   * Get current inventory levels and low-stock alerts
   */
  getInventoryReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers and accountants can access inventory reports
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = inventoryReportQuerySchema.parse(req.query);

      // Use user's branch if not specified
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      const report = await this.reportsService.getInventoryReport(
        branchId,
        req.user.organizationId,
        query.asOfDate,
        query.startDate,
        query.endDate
      );

      res.json({
        report,
        message: 'Inventory report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/fuel-price-history
   * Get fuel price history report with all price changes
   */
  getFuelPriceHistoryReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers and accountants can access price history reports
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = fuelPriceHistoryQuerySchema.parse(req.query);

      const report = await this.reportsService.getFuelPriceHistoryReport(
        query.startDate,
        query.endDate,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Fuel price history report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/reports/customer-wise-sales
   * Get customer-wise sales report with product variant and payment type segregation
   */
  getCustomerWiseSalesReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only managers and accountants can access customer-wise sales reports
      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = customerWiseSalesQuerySchema.parse(req.query);

      // Validate date range
      if (query.startDate > query.endDate) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }

      // Use user's branch if not specified
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      const report = await this.reportsService.getCustomerWiseSalesReport(
        branchId,
        query.startDate,
        query.endDate,
        req.user.organizationId,
        query.customerId
      );

      res.json({
        report,
        message: 'Customer-wise sales report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
