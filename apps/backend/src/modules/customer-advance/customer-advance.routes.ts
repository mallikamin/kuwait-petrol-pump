import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { CustomerAdvanceController } from './customer-advance.controller';

const router = Router();
const controller = new CustomerAdvanceController();

router.use(authenticate);

router.get('/balance', controller.getBalance);
router.get('/movements', controller.listMovements);
router.post('/deposits', controller.deposit);
router.post('/cash-handouts', controller.cashHandout);
router.post('/movements/:id/void', controller.voidMovement);

export default router;
