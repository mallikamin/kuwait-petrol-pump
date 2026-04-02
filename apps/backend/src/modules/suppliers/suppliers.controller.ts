import { Request, Response, NextFunction } from 'express';
import { SuppliersService } from './suppliers.service';
import {
  createSupplierSchema,
  updateSupplierSchema,
  getSuppliersQuerySchema,
  idParamSchema,
} from './suppliers.schema';
import { AppError } from '../../middleware/error.middleware';

const suppliersService = new SuppliersService();

export class SuppliersController {
  /**
   * GET /api/suppliers
   */
  async getAllSuppliers(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const query = getSuppliersQuerySchema.parse(req.query);
      const result = await suppliersService.getAllSuppliers(organizationId, query);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/suppliers/:id
   */
  async getSupplierById(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const supplier = await suppliersService.getSupplierById(id, organizationId);

      res.json(supplier);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/suppliers
   */
  async createSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const data = createSupplierSchema.parse(req.body);
      const supplier = await suppliersService.createSupplier(organizationId, data);

      res.status(201).json(supplier);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/suppliers/:id
   */
  async updateSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const data = updateSupplierSchema.parse(req.body);
      const supplier = await suppliersService.updateSupplier(id, organizationId, data);

      res.json(supplier);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/suppliers/:id
   */
  async deleteSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      await suppliersService.deleteSupplier(id, organizationId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/suppliers/:id/balance
   */
  async getSupplierBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const balance = await suppliersService.getSupplierBalance(id, organizationId);

      res.json(balance);
    } catch (error) {
      next(error);
    }
  }
}
