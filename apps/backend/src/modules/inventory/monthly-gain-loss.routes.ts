import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { MonthlyGainLossController } from './monthly-gain-loss.controller';

const router = Router();
const controller = new MonthlyGainLossController();

// POST /api/inventory/monthly-gain-loss - Create entry (legacy month-keyed)
router.post('/', authenticate, controller.createEntry);

// POST /api/inventory/monthly-gain-loss/by-date - Create entry on specific date
// (auto-computes gain/loss from measured liters when measuredQty supplied,
//  snapshots lastPurchaseRate + bookQtyAtDate at write time)
router.post('/by-date', authenticate, controller.createByDate);

// GET /api/inventory/monthly-gain-loss/stock-at-date - Book stock + last
// purchase rate at a calendar date. Drives the Gain/Loss form's live
// "current PMG/HSD level" display.
router.get('/stock-at-date', authenticate, controller.stockAtDate);

// GET /api/inventory/monthly-gain-loss - List entries (supports startDate/endDate)
router.get('/', authenticate, controller.getEntries);

// GET /api/inventory/monthly-gain-loss/summary - Get month summary
router.get('/summary', authenticate, controller.getMonthSummary);

// GET /api/inventory/monthly-gain-loss/:id - Get single entry
router.get('/:id', authenticate, controller.getEntryById);

// DELETE /api/inventory/monthly-gain-loss/:id - Delete entry
router.delete('/:id', authenticate, controller.deleteEntry);

export default router;
