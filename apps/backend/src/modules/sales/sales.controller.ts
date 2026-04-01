import { Request, Response, NextFunction } from 'express';
import { SalesService } from './sales.service';
import { hasRole } from '../../middleware/auth.middleware';
import {
  createFuelSaleSchema,
  createNonFuelSaleSchema,
  getSalesQuerySchema,
  getSummaryQuerySchema,
  idParamSchema,
  CreateFuelSaleInput,
  CreateNonFuelSaleInput,
} from './sales.schema';

export class SalesController {
  private salesService: SalesService;

  constructor() {
    this.salesService = new SalesService();
  }

  /**
   * POST /api/sales/fuel
   * Create a fuel sale
   */
  createFuelSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only cashier, operator, manager can create sales
      if (!hasRole(req.user, ['admin', 'manager', 'cashier', 'operator'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data: CreateFuelSaleInput = createFuelSaleSchema.parse(req.body);

      const sale = await this.salesService.createFuelSale(data, req.user.userId, req.user.organizationId);

      res.status(201).json({
        sale,
        message: 'Fuel sale created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/sales/non-fuel
   * Create a non-fuel sale
   */
  createNonFuelSale = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only cashier, operator, manager can create sales
      if (!hasRole(req.user, ['admin', 'manager', 'cashier', 'operator'])) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data: CreateNonFuelSaleInput = createNonFuelSaleSchema.parse(req.body);

      const sale = await this.salesService.createNonFuelSale(data, req.user.userId, req.user.organizationId);

      res.status(201).json({
        sale,
        message: 'Non-fuel sale created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/sales
   * Get sales with filters
   */
  getSales = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const filters = getSalesQuerySchema.parse(req.query);

      const result = await this.salesService.getSales(req.user.organizationId, filters);

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/sales/:id
   * Get sale by ID
   */
  getSaleById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const sale = await this.salesService.getSaleById(id, req.user.organizationId);

      res.json({ sale });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/sales/summary
   * Get sales summary
   */
  getSalesSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const filters = getSummaryQuerySchema.parse(req.query);

      const summary = await this.salesService.getSalesSummary(
        filters.branchId,
        req.user.organizationId,
        filters
      );

      res.json({ summary });
    } catch (error) {
      next(error);
    }
  };
}
