import { Router } from 'express';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new PurchaseOrdersController();

// All routes require authentication
router.use(authenticate);

router.get('/', controller.getAllPurchaseOrders.bind(controller));
router.get('/:id', controller.getPurchaseOrderById.bind(controller));
router.post('/', controller.createPurchaseOrder.bind(controller));
router.put('/:id', controller.updatePurchaseOrder.bind(controller));
router.post('/:id/confirm', controller.confirmPurchaseOrder.bind(controller));
router.post('/:id/cancel', controller.cancelPurchaseOrder.bind(controller));
router.post('/:id/receive', controller.receiveStock.bind(controller));
router.post('/:id/payment', controller.recordPayment.bind(controller));

export default router;
