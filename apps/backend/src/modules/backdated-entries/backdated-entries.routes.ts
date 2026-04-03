import { Router } from 'express';
import { BackdatedEntriesController } from './backdated-entries.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BackdatedEntriesController();

// All routes require authentication
router.use(authenticate);

/**
 * Backdated Entry Routes
 */

// GET /api/backdated-entries - Get all entries with filters
router.get('/', controller.getAllEntries);

// GET /api/backdated-entries/reconciliation/daily - Get daily reconciliation summary
router.get('/reconciliation/daily', controller.getDailyReconciliation);

// GET /api/backdated-entries/:id - Get a single entry
router.get('/:id', controller.getEntryById);

// POST /api/backdated-entries - Create a new entry
router.post('/', controller.createEntry);

// PUT /api/backdated-entries/:id - Update an entry
router.put('/:id', controller.updateEntry);

// DELETE /api/backdated-entries/:id - Delete an entry
router.delete('/:id', controller.deleteEntry);

/**
 * Backdated Transaction Routes (nested under entry)
 */

// GET /api/backdated-entries/:id/transactions - Get all transactions for an entry
router.get('/:id/transactions', controller.getTransactions);

// POST /api/backdated-entries/:id/transactions - Create a transaction
router.post('/:id/transactions', controller.createTransaction);

// POST /api/backdated-entries/:id/reconcile - Reconcile an entry
router.post('/:id/reconcile', controller.reconcileEntry);

/**
 * Backdated Transaction Direct Routes
 */

// PUT /api/backdated-transactions/:id - Update a transaction
router.put('/transactions/:id', controller.updateTransaction);

// DELETE /api/backdated-transactions/:id - Delete a transaction
router.delete('/transactions/:id', controller.deleteTransaction);

export default router;
