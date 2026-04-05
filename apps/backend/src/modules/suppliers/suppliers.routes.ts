import { Router } from 'express';
import { SuppliersController } from './suppliers.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new SuppliersController();

// All routes require authentication
router.use(authenticate);

router.get('/', controller.getAllSuppliers.bind(controller));
router.get('/:id', controller.getSupplierById.bind(controller));
router.post('/', controller.createSupplier.bind(controller));
router.put('/:id', controller.updateSupplier.bind(controller));
router.delete('/:id', controller.deleteSupplier.bind(controller));
router.get('/:id/balance', controller.getSupplierBalance.bind(controller));

export default router;
