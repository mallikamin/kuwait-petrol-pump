import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CustomersService } from './customers.service';

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Customer name is required'),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  vehicleNumbers: z.array(z.string()).optional(),
  creditLimit: z.number().positive().optional(),
  creditDays: z.number().int().positive().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  vehicleNumbers: z.array(z.string()).optional(),
  creditLimit: z.number().positive().optional(),
  creditDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

const getCustomersQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

const getLedgerQuerySchema = z.object({
  startDate: z.string().datetime().transform(val => new Date(val)).optional(),
  endDate: z.string().datetime().transform(val => new Date(val)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
  offset: z.string().transform(val => parseInt(val, 10)).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export class CustomersController {
  private customersService: CustomersService;

  constructor() {
    this.customersService = new CustomersService();
  }

  /**
   * GET /api/customers
   * Get all customers with filters
   */
  getAllCustomers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const filters = getCustomersQuerySchema.parse(req.query);

      const result = await this.customersService.getAllCustomers(
        req.user.organizationId,
        filters
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/customers
   * Create a new customer
   */
  createCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin and manager can create customers
      if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const data = createCustomerSchema.parse(req.body);

      const customer = await this.customersService.createCustomer(
        data as any,
        req.user.organizationId
      );

      res.status(201).json({
        customer,
        message: 'Customer created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/customers/:id
   * Get customer by ID
   */
  getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);

      const customer = await this.customersService.getCustomerById(
        id,
        req.user.organizationId
      );

      res.json({ customer });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/customers/:id
   * Update customer
   */
  updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Only admin and manager can update customers
      if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { id } = idParamSchema.parse(req.params);
      const data = updateCustomerSchema.parse(req.body);

      const customer = await this.customersService.updateCustomer(
        id,
        req.user.organizationId,
        data
      );

      res.json({
        customer,
        message: 'Customer updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/customers/:id/ledger
   * Get customer sales ledger
   */
  getCustomerLedger = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = idParamSchema.parse(req.params);
      const filters = getLedgerQuerySchema.parse(req.query);

      const ledger = await this.customersService.getCustomerLedger(
        id,
        req.user.organizationId,
        filters
      );

      res.json(ledger);
    } catch (error) {
      next(error);
    }
  };
}
