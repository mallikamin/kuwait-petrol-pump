import { Router } from 'express';
import { CreditController } from './credit.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new CreditController();

// All routes require authentication
router.use(authenticate);

/**
 * Receipt Operations
 */

// POST /api/credit/receipts - Create receipt
router.post('/receipts', controller.createReceipt);

// PUT /api/credit/receipts/:id - Update receipt
router.put('/receipts/:id', controller.updateReceipt);

// DELETE /api/credit/receipts/:id - Soft delete receipt
router.delete('/receipts/:id', controller.deleteReceipt);

// GET /api/credit/receipts - List receipts
router.get('/receipts', controller.getReceipts);

// GET /api/credit/receipts/:id - Get receipt detail
router.get('/receipts/:id', controller.getReceiptById);

/**
 * Ledger & Balance
 */

// GET /api/credit/customers/:id/ledger - Customer ledger
router.get('/customers/:id/ledger', controller.getCustomerLedger);

// GET /api/credit/customers/:id/balance - Customer balance
router.get('/customers/:id/balance', controller.getCustomerBalance);

// GET /api/credit/customers/:id/open-invoices - Open invoices
router.get('/customers/:id/open-invoices', controller.getOpenInvoices);

// GET /api/credit/check-limit - Credit limit check
router.get('/check-limit', controller.checkCreditLimit);

/**
 * Reporting
 */

// GET /api/credit/report/party-position - Party position report
router.get('/report/party-position', controller.getPartyPositionReport);

// GET /api/credit/report/export - Export report
router.get('/report/export', controller.exportReport);

/**
 * Credit Limits
 */

// PUT /api/credit/customers/:id/branch-limit - Set branch limit
router.put('/customers/:id/branch-limit', controller.setBranchLimit);

// GET /api/credit/customers/:id/branch-limits - Get branch limits
router.get('/customers/:id/branch-limits', controller.getBranchLimits);

export default router;
