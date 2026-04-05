import { Request, Response, NextFunction } from 'express';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockReceiptService } from './stock-receipt.service';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  receiveStockSchema,
  recordPaymentSchema,
  getPurchaseOrdersQuerySchema,
  idParamSchema,
} from './purchase-orders.schema';
import { AppError } from '../../middleware/error.middleware';

const purchaseOrdersService = new PurchaseOrdersService();
const stockReceiptService = new StockReceiptService();

export class PurchaseOrdersController {
  /**
   * GET /api/purchase-orders
   */
  async getAllPurchaseOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const query = getPurchaseOrdersQuerySchema.parse(req.query);
      const result = await purchaseOrdersService.getAllPurchaseOrders(organizationId, query);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/purchase-orders/:id
   */
  async getPurchaseOrderById(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const po = await purchaseOrdersService.getPurchaseOrderById(id, organizationId);

      res.json(po);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/purchase-orders
   */
  async createPurchaseOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const data = createPurchaseOrderSchema.parse(req.body);
      const po = await purchaseOrdersService.createPurchaseOrder(organizationId, data);

      res.status(201).json(po);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/purchase-orders/:id
   */
  async updatePurchaseOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const data = updatePurchaseOrderSchema.parse(req.body);
      const po = await purchaseOrdersService.updatePurchaseOrder(id, organizationId, data);

      res.json(po);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/purchase-orders/:id/confirm
   */
  async confirmPurchaseOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const po = await purchaseOrdersService.confirmPurchaseOrder(id, organizationId);

      res.json(po);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/purchase-orders/:id/cancel
   */
  async cancelPurchaseOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const po = await purchaseOrdersService.cancelPurchaseOrder(id, organizationId);

      res.json(po);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/purchase-orders/:id/receive
   */
  async receiveStock(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      if (!organizationId || !userId) {
        throw new AppError(401, 'User not authenticated');
      }

      const { id } = idParamSchema.parse(req.params);
      const data = receiveStockSchema.parse(req.body);
      const receipt = await stockReceiptService.receiveStock(id, organizationId, userId, data);

      res.status(201).json(receipt);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/purchase-orders/:id/payment
   */
  async recordPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new AppError(401, 'Organization ID not found');
      }

      const { id } = idParamSchema.parse(req.params);
      const data = recordPaymentSchema.parse(req.body);
      const payment = await purchaseOrdersService.recordPayment(id, organizationId, data);

      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  }
}
