import { Router } from 'express';
import { BackdatedEntriesController } from './backdated-entries.controller';
import { DailyBackdatedEntriesController } from './daily.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BackdatedEntriesController();
const dailyController = new DailyBackdatedEntriesController();

// All routes require authentication
router.use(authenticate);

/**
 * Daily Consolidated Routes (for accountant workflow)
 */

// GET /api/backdated-entries/daily - Get daily consolidated summary
router.get('/daily', dailyController.getDailySummary);

// GET /api/backdated-entries/daily/forensic - Forensic transaction inspection (DIAGNOSTIC)
router.get('/daily/forensic', dailyController.getForensicTransactions);

// GET /api/backdated-entries/daily/deleted - List soft-deleted transactions
router.get('/daily/deleted', dailyController.getDeletedTransactions);

// POST /api/backdated-entries/daily - Save daily draft (upsert entries + transactions)
router.post('/daily', dailyController.saveDailyDraft);

// POST /api/backdated-entries/daily/finalize - Finalize day and enqueue QB sync
router.post('/daily/finalize', dailyController.finalizeDay);

// POST /api/backdated-entries/daily/restore - Restore soft-deleted transactions
router.post('/daily/restore', dailyController.restoreDeletedTransactions);

/**
 * Backdated Entry Routes (per-nozzle level)
 */

// GET /api/backdated-entries - Get all entries with filters
router.get('/', controller.getAllEntries);

// GET /api/backdated-entries/reconciliation/daily - Get daily reconciliation summary (LEGACY - use /daily instead)
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
