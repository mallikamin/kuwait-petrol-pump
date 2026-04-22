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

// Fuel price history report endpoint
router.get('/fuel-price-history', reportsController.getFuelPriceHistoryReport);

// Customer-wise sales report endpoint
router.get('/customer-wise-sales', reportsController.getCustomerWiseSalesReport);

// Product-wise summary report endpoint
router.get('/product-wise-summary', reportsController.getProductWiseSummaryReport);

// Phase 2-5 reports — see docs/verification-matrix.md § Task 4
router.get('/expenses', reportsController.getExpensesReport);
router.get('/customer-advance-balances', reportsController.getCustomerAdvanceBalances);
router.get('/pso-topups-summary', reportsController.getPsoTopupsSummary);
router.get('/cash-recon-history', reportsController.getCashReconHistory);

export default router;
