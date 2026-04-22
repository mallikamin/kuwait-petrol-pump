import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { CashReconciliationController } from './cash-reconciliation.controller';

const router = Router();
const controller = new CashReconciliationController();

router.use(authenticate);

router.get('/preview', controller.getPreview);
router.post('/submit', controller.submit);
router.post('/reopen', controller.reopen);

export default router;
