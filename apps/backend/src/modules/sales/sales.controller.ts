import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SalesService } from './sales.service';

const createFuelSaleSchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  nozzleId: z.string().uuid(),
  fuelTypeId: z.string().uuid(),
  quantityLiters: z.number().positive(),
  pricePerLiter: z.number().positive(),
  paymentMethod: z.enum(['cash', 'credit', 'card', 'pso_card']),
  customerId: z.string().uuid().optional(),
  vehicleNumber: z.string().optional(),
  slipNumber: z.string().optional(),
});

const createNonFuelSaleSchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive(),
    })
  ).min(1),
  paymentMethod: z.enum(['cash', 'credit', 'card']),
  customerId: z.string().uuid().optional(),
  taxAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
});

const getSalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  shiftInstanceId: z.string().uuid().optional(),
  saleType: z.enum(['fuel', 'non_fuel']).optional(),
  paymentMethod: z.string().optional(),
  customerId: z.string().uuid().optional(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

const getSummaryQuerySchema = z.object({
  branchId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

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
      if (!['admin', 'manager', 'cashier', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createFuelSaleSchema.parse(req.body);

      const sale = await this.salesService.createFuelSale(data as any, req.user.userId, req.user.organizationId);

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
      if (!['admin', 'manager', 'cashier', 'operator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createNonFuelSaleSchema.parse(req.body);

      const sale = await this.salesService.createNonFuelSale(data as any, req.user.userId, req.user.organizationId);

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
