import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { CashLedgerController } from './cash-ledger.controller';

const router = Router();
const controller = new CashLedgerController();

router.use(authenticate);

// GET /api/cash-ledger/day?branchId=...&businessDate=YYYY-MM-DD
router.get('/day', controller.getDaySummary);

// POST /api/cash-ledger/manual-adjustment  { branchId, businessDate, direction, amount, memo }
router.post('/manual-adjustment', controller.createManualAdjustment);

// POST /api/cash-ledger/reverse  { entryId, reason }
router.post('/reverse', controller.reverseEntry);

export default router;
