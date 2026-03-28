/**
 * Offline Sync Routes
 * Sprint 1: Offline Foundation + Pre-Deployment Hardening
 *
 * API endpoints for offline sync operations.
 * ⚠️ SECURITY: All routes require authentication (JWT).
 * ⚠️ MULTI-TENANT: Tenant validation enforced in service layer.
 */

import { Router } from 'express';
import { SyncController } from './sync.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = Router();

/**
 * POST /api/sync/queue
 * Bulk upload queued transactions (sales + meter readings)
 *
 * Auth: Required (cashier, operator, manager roles)
 * Body: { deviceId, sales?, meterReadings? }
 * Response: { success, synced, failed, duplicates, details }
 *
 * Note: userId and organizationId derived from JWT (req.user)
 */
router.post(
  '/queue',
  authenticate,
  authorize('cashier', 'operator', 'manager', 'admin'),
  SyncController.syncQueue
);

/**
 * GET /api/sync/status
 * Get sync status for authenticated user
 *
 * Auth: Required (all roles)
 * Response: { pendingSales, pendingMeterReadings, lastSyncAt, failedCount }
 *
 * Note: Returns status for req.user.userId only (no cross-user access)
 */
router.get('/status', authenticate, SyncController.getSyncStatus);

/**
 * POST /api/sync/retry
 * Retry failed sync records for authenticated user
 *
 * Auth: Required (cashier, operator, manager roles)
 * Body: { maxRetries? }
 * Response: { retried }
 *
 * Note: Retries failed records for req.user.userId only
 */
router.post(
  '/retry',
  authenticate,
  authorize('cashier', 'operator', 'manager', 'admin'),
  SyncController.retryFailed
);

export default router;
