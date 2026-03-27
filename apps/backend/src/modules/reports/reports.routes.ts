import { Router } from 'express';
import { ReportsController } from './reports.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const reportsController = new ReportsController();

// All routes require authentication
router.use(authenticate);

// Daily sales report endpoint
router.get('/daily-sales', reportsController.getDailySalesReport);

// Shift report endpoint
router.get('/shift', reportsController.getShiftReport);

// Variance report endpoint
router.get('/variance', reportsController.getVarianceReport);

// Customer ledger report endpoint
router.get('/customer-ledger', reportsController.getCustomerLedgerReport);

// Inventory report endpoint
router.get('/inventory', reportsController.getInventoryReport);

export default router;
