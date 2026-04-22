import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { PsoTopupController } from './pso-topup.controller';

const router = Router();
const controller = new PsoTopupController();

router.use(authenticate);

router.get('/', controller.list);
router.post('/', controller.create);
router.post('/:id/void', controller.void);

export default router;
