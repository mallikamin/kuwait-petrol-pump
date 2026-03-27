import { Router } from 'express';
import { MeterReadingsController } from './meter-readings.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const meterReadingsController = new MeterReadingsController();

// All routes require authentication
router.use(authenticate);

router.post('/', meterReadingsController.createMeterReading);
router.get('/:nozzleId/latest', meterReadingsController.getLatestReading);
router.put('/:id/verify', meterReadingsController.verifyReading);
router.get('/shift/:shiftId', meterReadingsController.getReadingsByShift);
router.get('/shift/:shiftId/variance', meterReadingsController.getVarianceReport);

export default router;
