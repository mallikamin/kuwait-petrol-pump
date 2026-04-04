import { Router } from 'express';
import { BackdatedMeterReadingsDailyController } from './meter-readings-daily.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BackdatedMeterReadingsDailyController();

// All routes require authentication
router.use(authenticate);

/**
 * Backdated Meter Readings Daily Route
 *
 * Provides shift-segregated view of meter readings for backdated entry workflow.
 * Sources data from meter_readings + shift_instances (single source of truth).
 *
 * GET /api/backdated-meter-readings/daily
 *
 * Query params:
 * - branchId (required): UUID
 * - businessDate (required): YYYY-MM-DD
 *
 * Returns shift-segregated matrix with derivation status:
 * - entered: explicit meter reading exists
 * - derived_from_prev_shift: computed from previous shift's closing
 * - derived_from_next_shift: computed from next shift's opening
 * - missing: no data available
 */
router.get('/daily', controller.getDailyMeterReadings.bind(controller));

export default router;
