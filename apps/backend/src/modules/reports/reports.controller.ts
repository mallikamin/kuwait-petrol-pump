import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReportsService } from './reports.service';

// Validation schemas
const dailySalesQuerySchema = z.object({
  branchId: z.string().uuid(),
  date: z.string().datetime().transform(val => new Date(val)),
});

const shiftReportQuerySchema = z.object({
  shiftInstanceId: z.string().uuid(),
});

const varianceReportQuerySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().datetime().transform(val => new Date(val)),
  endDate: z.string().datetime().transform(val => new Date(val)),
});

const customerLedgerQuerySchema = z.object({
  customerId: z.string().uuid(),
  startDate: z.string().datetime().transform(val => new Date(val)),
  endDate: z.string().datetime().transform(val => new Date(val)),
});

const inventoryReportQuerySchema = z.object({
  branchId: z.string().uuid(),
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

      // Only managers and accountants can access all branch reports
      // Cashiers/operators can only access their own shift reports
      if (!['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = dailySalesQuerySchema.parse(req.query);

      const report = await this.reportsService.getDailySalesReport(
        query.branchId,
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

      // Verify user has permission to view this shift report
      // For now, allow managers/accountants to view all, and cashiers/operators to view their own
      const canViewAllReports = ['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(req.user.role);

      if (!canViewAllReports) {
        // Cashiers/operators can only view their own shift reports
        // This would require checking if the user opened/closed this shift
        // For now, we'll restrict access
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

      // Only managers and accountants can access variance reports
      if (!['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = varianceReportQuerySchema.parse(req.query);

      // Validate date range
      if (query.startDate > query.endDate) {
        return res.status(400).json({ error: 'Start date must be before end date' });
      }

      const report = await this.reportsService.getVarianceReport(
        query.branchId,
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
      if (!['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(req.user.role)) {
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
      if (!['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = inventoryReportQuerySchema.parse(req.query);

      const report = await this.reportsService.getInventoryReport(
        query.branchId,
        req.user.organizationId
      );

      res.json({
        report,
        message: 'Inventory report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
