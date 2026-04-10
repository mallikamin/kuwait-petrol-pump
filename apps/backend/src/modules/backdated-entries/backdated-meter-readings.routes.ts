import { Router } from 'express';
import { BackdatedMeterReadingsDailyController } from './meter-readings-daily.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BackdatedMeterReadingsDailyController();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/backdated-meter-readings/daily
 *
 * Fetch meter readings for a specific business date (no shift segregation).
 * Sources data from backdated_meter_readings table only.
 *
 * Query params:
 * - branchId (required): UUID
 * - businessDate (required): YYYY-MM-DD
 *
 * Returns:
 * - nozzles: array of meter reading statuses (opening/closing)
 * - summary: completion stats
 */
router.get('/daily', controller.getDailyMeterReadings.bind(controller));

/**
 * GET /api/backdated-meter-readings/daily/modal/previous-reading
 *
 * Get previous reading for modal display (shift-aware context).
 * Query params:
 * - branchId (required): UUID
 * - businessDate (required): YYYY-MM-DD
 * - shiftId (required): UUID
 * - nozzleId (required): UUID
 * - readingType (required): 'opening' | 'closing'
 */
router.get('/daily/modal/previous-reading', controller.getModalPreviousReading.bind(controller));

/**
 * POST /api/backdated-meter-readings/daily
 *
 * Save a single meter reading for backdated entry.
 * No shift required - uses businessDate only.
 *
 * Request body:
 * {
 *   branchId: string
 *   businessDate: string (YYYY-MM-DD)
 *   nozzleId: string
 *   readingType: 'opening' | 'closing'
 *   meterValue: number
 *   source?: 'manual' | 'ocr'
 *   imageUrl?: string
 *   attachmentUrl?: string
 *   ocrConfidence?: number
 *   ocrManuallyEdited?: boolean
 * }
 */
router.post('/daily', controller.saveMeterReading.bind(controller));

/**
 * PATCH /api/backdated-meter-readings/daily/:readingId
 *
 * Update a meter reading (partial update).
 *
 * Request body:
 * {
 *   meterValue?: number
 *   attachmentUrl?: string
 *   ocrManuallyEdited?: boolean
 * }
 */
router.patch('/daily/:readingId', controller.updateMeterReading.bind(controller));

/**
 * DELETE /api/backdated-meter-readings/daily/:readingId
 *
 * Delete a specific meter reading by ID.
 */
router.delete('/daily/:readingId', controller.deleteMeterReading.bind(controller));

export default router;
