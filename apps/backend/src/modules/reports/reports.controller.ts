import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReportsService } from './reports.service';

// Validation schemas
const dateString = z.string().transform(val => new Date(val)).refine(d => !isNaN(d.getTime()), { message: 'Invalid date' });

const dailySalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: dateString.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).refine(
  (data) => {
    // Validate that if startDate/endDate are provided, both must be present
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    // All 3 modes valid: (1) no filter, (2) date only, (3) range
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

const shiftReportQuerySchema = z.object({
  shiftInstanceId: z.string().uuid(),
});

const varianceReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
}).refine(
  (data) => {
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

const customerLedgerQuerySchema = z.object({
  customerId: z.string().refine(
    (val) => z.string().uuid().safeParse(val).success || val === '__walkin__',
    { message: 'customerId must be a UUID or "__walkin__"' }
  ),
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
}).refine(
  (data) => {
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

const inventoryReportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  asOfDate: z.string().optional(), // ISO date string for snapshot as-of-date (single date)
  startDate: z.string().optional(), // ISO date string for range start
  endDate: z.string().optional(), // ISO date string for range end
  // Product-Wise Movement filters (date-range mode only). Optional — keeps
  // backward compatibility with existing consumers that don't send these.
  category: z.enum(['all', 'total_fuel', 'HSD', 'PMG', 'non_fuel']).optional(),
  productId: z.string().uuid().optional(),
});

const fuelPriceHistoryQuerySchema = z.object({
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
}).refine(
  (data) => {
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

const customerWiseSalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  customerId: z.string().uuid().optional(),
}).refine(
  (data) => {
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

const productWiseSummaryQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  productType: z.enum(['all', 'fuel', 'non_fuel']).optional(),
  productId: z.string().uuid().optional(),
}).refine(
  (data) => {
    if (data.startDate && !data.endDate) return false;
    if (data.endDate && !data.startDate) return false;
    return true;
  },
  { message: 'If providing date range, both startDate and endDate required' }
);

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

      // Parse dates with proper timezone handling
      // Precedence: startDate/endDate > date > no filter (all data)
      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        // Date range mode
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);
      } else if (query.date) {
        // Single date mode
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        // No filter mode - get all data
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getDailySalesReport(
        branchId,
        startDate,
        endDate,
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

      // Use user's branch if not specified
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      // Parse dates with proper timezone handling
      // Precedence: startDate/endDate > date > no filter (all data)
      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        // Date range mode
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        if (startDate > endDate) {
          return res.status(400).json({ error: 'Start date must be before end date' });
        }
      } else if (query.date) {
        // Single date mode
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        // No filter mode - get all data
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getVarianceReport(
        branchId,
        startDate,
        endDate,
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

      // Parse dates with proper timezone handling
      // Precedence: startDate/endDate > date > no filter (all data)
      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        // Date range mode
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        if (startDate > endDate) {
          return res.status(400).json({ error: 'Start date must be before end date' });
        }
      } else if (query.date) {
        // Single date mode
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        // No filter mode - get all data
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getCustomerLedgerReport(
        query.customerId,
        startDate,
        endDate,
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
        query.endDate,
        (query.category as 'all' | 'total_fuel' | 'HSD' | 'PMG' | 'non_fuel' | undefined) || 'all',
        query.productId
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

      // Parse dates with proper timezone handling
      // Precedence: startDate/endDate > date > no filter (all data)
      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        // Date range mode
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);
      } else if (query.date) {
        // Single date mode
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        // No filter mode - get all data
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getFuelPriceHistoryReport(
        startDate,
        endDate,
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

      // Use user's branch if not specified
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      // Parse dates with proper timezone handling
      // Precedence: startDate/endDate > date > no filter (all data)
      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        // Date range mode
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        if (startDate > endDate) {
          return res.status(400).json({ error: 'Start date must be before end date' });
        }
      } else if (query.date) {
        // Single date mode
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        // No filter mode - get all data
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getCustomerWiseSalesReport(
        branchId,
        startDate,
        endDate,
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

  /**
   * GET /api/reports/product-wise-summary
   * Product-wise detailed report (fuel + non-fuel)
   */
  getProductWiseSummaryReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!['admin', 'manager', 'accountant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const query = productWiseSummaryQuerySchema.parse(req.query);
      const branchId = query.branchId || req.user.branchId;

      if (!branchId) {
        return res.status(400).json({ error: 'branchId required (user has no assigned branch)' });
      }

      let startDate: Date;
      let endDate: Date;

      if (query.startDate && query.endDate) {
        startDate = new Date(query.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        if (startDate > endDate) {
          return res.status(400).json({ error: 'Start date must be before end date' });
        }
      } else if (query.date) {
        startDate = new Date(query.date);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(query.date);
        endDate.setUTCHours(23, 59, 59, 999);
      } else {
        startDate = new Date('1970-01-01');
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date('2099-12-31');
        endDate.setUTCHours(23, 59, 59, 999);
      }

      const report = await this.reportsService.getProductWiseSummaryReport(
        branchId,
        startDate,
        endDate,
        req.user.organizationId,
        query.productType || 'all',
        query.productId
      );

      res.json({
        report,
        message: 'Product-wise summary report retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
