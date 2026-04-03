import { Router } from 'express';
import { BackdatedEntriesController } from './backdated-entries.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BackdatedEntriesController();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/backdated-entries
 * Create a backdated entry (meter readings + bifurcation)
 * Access: admin, manager, accountant
 */
router.post('/', controller.createBackdatedEntry);

/**
 * GET /api/backdated-entries
 * Get backdated entries summary
 * Access: admin, manager, accountant
 */
router.get('/', controller.getBackdatedEntries);

export default router;
