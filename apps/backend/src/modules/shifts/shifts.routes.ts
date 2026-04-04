import { Router } from 'express';
import { ShiftsController } from './shifts.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const shiftsController = new ShiftsController();

// All routes require authentication
router.use(authenticate);

router.post('/', shiftsController.createShift);
router.get('/', shiftsController.getAllShifts);
router.post('/open', shiftsController.openShift);
router.post('/:id/close', shiftsController.closeShift);
router.get('/current', shiftsController.getCurrentShift);
router.get('/history', shiftsController.getShiftHistory);
router.get('/instances-for-date', shiftsController.getShiftInstancesForDate);
router.get('/:id', shiftsController.getShiftById);

export default router;
