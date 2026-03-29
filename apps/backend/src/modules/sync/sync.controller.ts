/**
 * Offline Sync Controller
 * Sprint 1: Offline Foundation + Pre-Deployment Hardening
 *
 * HTTP request handlers for sync endpoints.
 * ⚠️ SECURITY: req.user populated by authenticate middleware (JWT).
 * ⚠️ MULTI-TENANT: userId and organizationId derived from JWT, not client.
 */

import { Request, Response } from 'express';
import { SyncService } from './sync.service';

export class SyncController {
  /**
   * POST /api/sync/queue
   * Bulk upload queued transactions (sales + meter readings)
   *
   * Auth: Required (req.user must be set by authenticate middleware)
   * Request body: { deviceId, sales?, meterReadings? }
   * Response: Combined sync results
   */
  static async syncQueue(req: Request, res: Response): Promise<void> {
    try {
      // req.user populated by authenticate middleware
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { deviceId, sales, meterReadings } = req.body;

      // Validate required fields
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }

      // Batch size limit (prevent memory issues)
      const totalRecords = (sales?.length || 0) + (meterReadings?.length || 0);
      if (totalRecords > 1000) {
        res.status(400).json({
          error: 'Batch size limit exceeded (max 1000 records per request)',
        });
        return;
      }

      const results = {
        sales: { synced: 0, failed: 0, duplicates: 0, success: true, errors: [] },
        meterReadings: { synced: 0, failed: 0, duplicates: 0, success: true, errors: [] },
      };

      // SECURITY: Overwrite client-supplied identity fields with JWT-authenticated user
      // Prevents spoofing cashierId/recordedBy and audit corruption
      if (sales && sales.length > 0) {
        for (const sale of sales) {
          sale.cashierId = req.user.userId;
        }
        results.sales = await SyncService.syncSales(
          sales,
          req.user.organizationId
        );
      }

      if (meterReadings && meterReadings.length > 0) {
        for (const reading of meterReadings) {
          reading.recordedBy = req.user.userId;
        }
        results.meterReadings = await SyncService.syncMeterReadings(
          meterReadings,
          req.user.organizationId
        );
      }

      // Calculate totals
      const totalSynced = results.sales.synced + results.meterReadings.synced;
      const totalFailed = results.sales.failed + results.meterReadings.failed;
      const totalDuplicates =
        results.sales.duplicates + results.meterReadings.duplicates;

      // Determine overall success
      const success = totalFailed === 0;

      res.status(success ? 200 : 207).json({
        success,
        synced: totalSynced,
        failed: totalFailed,
        duplicates: totalDuplicates,
        details: results,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }
  }

  /**
   * GET /api/sync/status
   * Get sync status for authenticated user
   *
   * Auth: Required (req.user.userId used automatically)
   * Response: SyncStatusResponse
   */
  static async getSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Use authenticated user's ID (no cross-user access)
      const status = await SyncService.getSyncStatus(req.user.userId);

      res.json(status);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get sync status',
      });
    }
  }

  /**
   * POST /api/sync/retry
   * Retry failed sync records for authenticated user
   *
   * Auth: Required (req.user.userId used automatically)
   * Request body: { maxRetries?: number }
   * Response: { retried: number }
   */
  static async retryFailed(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { maxRetries } = req.body;

      // Use authenticated user's ID (no cross-user access)
      const retried = await SyncService.retryFailed(
        req.user.userId,
        maxRetries || 3
      );

      res.json({
        success: true,
        retried,
        message: `${retried} failed records reset to pending for retry`,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Retry failed',
      });
    }
  }
}
