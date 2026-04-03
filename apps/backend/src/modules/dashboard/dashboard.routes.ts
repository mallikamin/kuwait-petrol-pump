import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new DashboardController();

// All routes require authentication
router.use(authenticate);

router.get('/stats', controller.getStats);
router.get('/sales-chart', controller.getSalesChart);
router.get('/payment-stats', controller.getPaymentStats);
router.get('/recent-transactions', controller.getRecentTransactions);
router.get('/low-stock', controller.getLowStock);
router.get('/top-customers', controller.getTopCustomers);
router.get('/liters-sold', controller.getLitersSold);

export default router;
