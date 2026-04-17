import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { MonthlyGainLossController } from './monthly-gain-loss.controller';

const router = Router();
const controller = new MonthlyGainLossController();

// POST /api/inventory/monthly-gain-loss - Create entry
router.post('/', authenticate, controller.createEntry);

// GET /api/inventory/monthly-gain-loss - List entries
router.get('/', authenticate, controller.getEntries);

// GET /api/inventory/monthly-gain-loss/summary - Get month summary
router.get('/summary', authenticate, controller.getMonthSummary);

// GET /api/inventory/monthly-gain-loss/:id - Get single entry
router.get('/:id', authenticate, controller.getEntryById);

// DELETE /api/inventory/monthly-gain-loss/:id - Delete entry
router.delete('/:id', authenticate, controller.deleteEntry);

export default router;
