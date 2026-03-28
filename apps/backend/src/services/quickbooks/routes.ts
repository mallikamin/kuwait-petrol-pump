/**
 * QuickBooks API Routes
 *
 * Management endpoints for QB integration:
 * - OAuth connection
 * - Safety gate controls
 * - Sync operations
 * - Replay & recovery
 * - Health monitoring
 */

import { Router, Request, Response } from 'express';
import {
  checkAllSafetyGates,
  enableWriteMode,
  disableWriteMode,
  activateKillSwitch,
  deactivateKillSwitch,
  approveSyncBatch,
} from './safety-gates';
import { ReplayService } from './replay';
import { RateLimiter } from './rate-limiter';
import { CompanyLock } from './company-lock';
import { AuditLogger } from './audit-logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const router = Router();

/**
 * GET /api/quickbooks/health
 * Check QB integration health status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Implementation would check:
    // - Connection active
    // - Rate limiter status
    // - Circuit breaker state
    // - Recent sync success rate

    res.json({
      status: 'healthy',
      message: 'QuickBooks integration operational',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/safety-gates
 * Get current safety gate status
 */
router.get('/safety-gates', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      return res.status(400).json({ error: 'organizationId required' });
    }

    // Import getSafetyStatus for gate status endpoint
    const { getSafetyStatus } = await import('./safety-gates');
    const gates = await getSafetyStatus(organizationId);

    res.json(gates);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/sync-mode
 * Set sync mode (READ_ONLY or WRITE_ENABLED)
 */
router.post('/safety-gates/sync-mode', async (req: Request, res: Response) => {
  try {
    const { organizationId, mode } = req.body;

    if (!organizationId || !mode) {
      return res.status(400).json({ error: 'organizationId and mode required' });
    }

    if (mode !== 'READ_ONLY' && mode !== 'WRITE_ENABLED') {
      return res.status(400).json({ error: 'mode must be READ_ONLY or WRITE_ENABLED' });
    }

    if (mode === 'WRITE_ENABLED') {
      await enableWriteMode(organizationId);
    } else {
      await disableWriteMode(organizationId);
    }

    await AuditLogger.log({
      operation: 'SYNC_MODE_CHANGE',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, mode },
    });

    res.json({ success: true, mode });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/kill-switch
 * Toggle global kill switch
 */
router.post('/safety-gates/kill-switch', async (req: Request, res: Response) => {
  try {
    const { organizationId, enabled } = req.body;

    if (!organizationId || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'organizationId and enabled (boolean) required' });
    }

    if (enabled) {
      await activateKillSwitch(organizationId);
    } else {
      await deactivateKillSwitch(organizationId);
    }

    await AuditLogger.log({
      operation: 'KILL_SWITCH',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, enabled },
    });

    res.json({ success: true, killSwitch: enabled });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/approve-batch
 * Approve a pending batch for sync
 */
router.post('/safety-gates/approve-batch', async (req: Request, res: Response) => {
  try {
    const { batchId, approvedBy, organizationId } = req.body;

    if (!batchId || !approvedBy || !organizationId) {
      return res.status(400).json({ error: 'batchId, approvedBy, and organizationId required' });
    }

    const approvedCount = await approveSyncBatch(batchId, approvedBy, organizationId);

    await AuditLogger.log({
      operation: 'BATCH_APPROVED',
      entity_type: 'batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { approvedBy, organizationId, approvedCount },
    });

    res.json({ success: true, approvedCount });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/batches/pending
 * List pending batches requiring approval
 */
router.get('/batches/pending', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      return res.status(400).json({ error: 'organizationId required' });
    }

    // List pending batches requiring approval
    const batches = await prisma.qBSyncQueue.groupBy({
      by: ['batchId'],
      where: {
        organizationId,
        approvalStatus: 'pending_approval',
        batchId: { not: null },
      },
      _count: {
        id: true,
      },
      _min: {
        createdAt: true,
      },
    });

    const result = batches
      .filter(b => b.batchId)
      .map(b => ({
        batchId: b.batchId!,
        jobCount: b._count.id,
        createdAt: b._min.createdAt,
      }));

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/replay/replayable
 * List batches eligible for replay
 */
router.get('/replay/replayable', async (req: Request, res: Response) => {
  try {
    const batches = await ReplayService.getReplayableBatches();

    res.json(batches);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/batch
 * Replay a failed batch
 */
router.post('/replay/batch', async (req: Request, res: Response) => {
  try {
    const { batchId, dryRun, maxRetries } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId required' });
    }

    const result = await ReplayService.replayBatch(batchId, {
      dryRun: dryRun || false,
      maxRetries: maxRetries || 3,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/restore-and-replay
 * Restore checkpoint and replay batch
 */
router.post('/replay/restore-and-replay', async (req: Request, res: Response) => {
  try {
    const { batchId, checkpointId, dryRun, maxRetries } = req.body;

    if (!batchId || !checkpointId) {
      return res.status(400).json({ error: 'batchId and checkpointId required' });
    }

    const result = await ReplayService.restoreAndReplay(batchId, checkpointId, {
      dryRun: dryRun || false,
      maxRetries: maxRetries || 3,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/replay/history/:batchId
 * Get replay history for a batch
 */
router.get('/replay/history/:batchId', async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const history = await ReplayService.getReplayHistory(batchId);

    res.json(history);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/cancel
 * Cancel a batch
 */
router.post('/replay/cancel', async (req: Request, res: Response) => {
  try {
    const { batchId, reason } = req.body;

    if (!batchId || !reason) {
      return res.status(400).json({ error: 'batchId and reason required' });
    }

    const result = await ReplayService.cancelBatch(batchId, reason);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/circuit-breaker/:connectionId
 * Get circuit breaker status
 */
router.get('/circuit-breaker/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    const status = await RateLimiter.getCircuitStatus(connectionId);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/circuit-breaker/reset
 * Reset circuit breaker
 */
router.post('/circuit-breaker/reset', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId required' });
    }

    await RateLimiter.resetCircuit(connectionId);

    await AuditLogger.log({
      operation: 'CIRCUIT_RESET',
      entity_type: 'connection',
      entity_id: connectionId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/company-lock/:connectionId
 * Get company lock status
 */
router.get('/company-lock/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    const status = await CompanyLock.getLockStatus(connectionId);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/audit/stats
 * Get audit statistics
 */
router.get('/audit/stats', async (req: Request, res: Response) => {
  try {
    const { entity_type, hours } = req.query;

    const stats = await AuditLogger.getStats(
      entity_type as string | undefined,
      hours ? parseInt(hours as string) : 24
    );

    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/audit/failures
 * Get recent failures
 */
router.get('/audit/failures', async (req: Request, res: Response) => {
  try {
    const { entity_type, hours } = req.query;

    const failures = await AuditLogger.getRecentFailures(
      hours ? parseInt(hours as string) : 24,
      entity_type as string | undefined
    );

    res.json(failures);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
