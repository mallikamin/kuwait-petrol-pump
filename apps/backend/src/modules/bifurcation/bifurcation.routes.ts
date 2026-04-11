import { Router } from 'express';
import { BifurcationController } from './bifurcation.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();
const bifurcationController = new BifurcationController();

// All routes require authentication
router.use(authenticate);

// POST /api/bifurcation - Create bifurcation (manager/accountant only)
router.post(
  '/',
  authorize('admin', 'manager', 'accountant'),
  bifurcationController.createBifurcation
);

// GET /api/bifurcation/summary - Get daily sales summary for bifurcation wizard
router.get('/summary', bifurcationController.getDailySalesSummary);

// GET /api/bifurcations/summary-range - Get reconciliation summary for date range (backdated meters)
router.get('/summary-range', bifurcationController.getReconciliationSummaryRange);

// GET /api/bifurcation/history - Get bifurcation history with filters
router.get('/history', bifurcationController.getBifurcationHistory);

// GET /api/bifurcation/pending - Get pending bifurcations for a branch
router.get('/pending', bifurcationController.getPendingBifurcations);

// GET /api/bifurcation/:date - Get bifurcation for a specific date
router.get('/:date', bifurcationController.getBifurcationByDate);

// PUT /api/bifurcation/:id/verify - Verify bifurcation (manager/accountant only)
router.put(
  '/:id/verify',
  authorize('admin', 'manager', 'accountant'),
  bifurcationController.verifyBifurcation
);

// GET /api/bifurcation/:id - Get bifurcation by ID
router.get('/:id', bifurcationController.getBifurcationById);

export default router;
