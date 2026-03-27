import { Router } from 'express';
import { SalesController } from './sales.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const salesController = new SalesController();

// All routes require authentication
router.use(authenticate);

router.post('/fuel', salesController.createFuelSale);
router.post('/non-fuel', salesController.createNonFuelSale);
router.get('/summary', salesController.getSalesSummary);
router.get('/:id', salesController.getSaleById);
router.get('/', salesController.getSales);

export default router;
