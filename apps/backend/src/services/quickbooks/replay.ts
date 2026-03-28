/**
 * QuickBooks Replay Service
 *
 * Rule 8: Batch replay from checkpoint
 * - Replay failed sync batches from last checkpoint
 * - Preserve idempotency during replay
 * - Track replay attempts and outcomes
 */

import { PrismaClient } from '@prisma/client';
import { restoreFromCheckpoint } from './checkpoint';
import { AuditLogger } from './audit-logger';

const prisma = new PrismaClient();

export interface ReplayResult {
  batchId: string;
  checkpointId: string;
  totalJobs: number;
  replayed: number;
  skipped: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

export class ReplayService {
  /**
   * Replay a failed batch from checkpoint
   */
  static async replayBatch(
    batchId: string,
    options: {
      dryRun?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<ReplayResult> {
    const { dryRun = false, maxRetries = 3 } = options;

    // Find all jobs in this batch
    const jobs = await prisma.qBSyncQueue.findMany({
      where: {
        batchId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (jobs.length === 0) {
      throw new Error(`Batch ${batchId} not found or has no jobs`);
    }

    // Find the checkpoint for this batch
    const checkpointId = jobs[0].checkpointId;
    if (!checkpointId) {
      throw new Error(`Batch ${batchId} has no checkpoint - cannot replay`);
    }

    await AuditLogger.log({
      operation: 'REPLAY_START',
      entity_type: 'batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: 'PENDING',
      metadata: {
        checkpointId,
        totalJobs: jobs.length,
        dryRun,
      },
    });

    const result: ReplayResult = {
      batchId,
      checkpointId,
      totalJobs: jobs.length,
      replayed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const job of jobs) {
      try {
        // Check if job can be replayed
        if (job.status === 'completed') {
          result.skipped++;
          continue;
        }

        if (job.retryCount >= maxRetries) {
          result.skipped++;
          await AuditLogger.log({
            operation: 'REPLAY_SKIP',
            entity_type: job.entityType,
            entity_id: job.id,
            direction: 'APP_TO_QB',
            status: 'FAILURE',
            error_message: `Max retries (${maxRetries}) exceeded`,
          });
          continue;
        }

        if (!dryRun) {
          // Reset job for replay
          await prisma.qBSyncQueue.update({
            where: { id: job.id },
            data: {
              status: 'pending',
              retryCount: job.retryCount + 1,
              nextRetryAt: new Date(),
              errorMessage: null,
              errorCode: null,
              errorDetail: null,
            },
          });
        }

        result.replayed++;

        await AuditLogger.log({
          operation: 'REPLAY_QUEUED',
          entity_type: job.entityType,
          entity_id: job.id,
          direction: 'APP_TO_QB',
          status: 'SUCCESS',
          metadata: {
            jobType: job.jobType,
            priority: job.priority,
            retryCount: job.retryCount + 1,
          },
        });
      } catch (error) {
        result.failed++;
        result.errors.push({
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });

        await AuditLogger.log({
          operation: 'REPLAY_FAILED',
          entity_type: job.entityType,
          entity_id: job.id,
          direction: 'APP_TO_QB',
          status: 'FAILURE',
          error_message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await AuditLogger.log({
      operation: 'REPLAY_COMPLETE',
      entity_type: 'batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: result.failed > 0 ? 'FAILURE' : 'SUCCESS',
      metadata: result,
    });

    return result;
  }

  /**
   * Restore database from checkpoint before replaying
   */
  static async restoreAndReplay(
    batchId: string,
    checkpointId: string,
    options: {
      dryRun?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<ReplayResult> {
    const { dryRun = false } = options;

    await AuditLogger.log({
      operation: 'RESTORE_START',
      entity_type: 'checkpoint',
      entity_id: checkpointId,
      direction: 'APP_TO_QB',
      status: 'PENDING',
      metadata: { batchId },
    });

    if (!dryRun) {
      // Restore checkpoint
      await restoreFromCheckpoint(checkpointId);

      await AuditLogger.log({
        operation: 'RESTORE_COMPLETE',
        entity_type: 'checkpoint',
        entity_id: checkpointId,
        direction: 'APP_TO_QB',
        status: 'SUCCESS',
      });
    }

    // Replay batch
    return this.replayBatch(batchId, options);
  }

  /**
   * Get replay history for a batch
   */
  static async getReplayHistory(
    batchId: string
  ): Promise<
    Array<{
      timestamp: Date;
      operation: string;
      status: string;
      metadata?: any;
    }>
  > {
    const logs = await prisma.quickBooksAuditLog.findMany({
      where: {
        entity_id: batchId,
        operation: {
          in: ['REPLAY_START', 'REPLAY_COMPLETE', 'REPLAY_QUEUED', 'REPLAY_FAILED'],
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      select: {
        created_at: true,
        operation: true,
        status: true,
        metadata: true,
      },
    });

    return logs.map(log => ({
      timestamp: log.created_at,
      operation: log.operation,
      status: log.status,
      metadata: log.metadata,
    }));
  }

  /**
   * Get all batches eligible for replay
   */
  static async getReplayableBatches(): Promise<
    Array<{
      batchId: string;
      checkpointId: string;
      failedJobs: number;
      totalJobs: number;
      lastFailedAt: Date;
    }>
  > {
    // Find batches with failed jobs
    const batches = await prisma.qBSyncQueue.groupBy({
      by: ['batchId'],
      where: {
        batchId: { not: null },
        status: { in: ['failed', 'dead_letter'] },
      },
      _count: {
        id: true,
      },
      _max: {
        completedAt: true,
      },
    });

    const replayableBatches = [];

    for (const batch of batches) {
      if (!batch.batchId) continue;

      // Get checkpoint and total jobs for this batch
      const jobs = await prisma.qBSyncQueue.findMany({
        where: { batchId: batch.batchId },
        select: {
          checkpointId: true,
        },
      });

      const checkpointId = jobs[0]?.checkpointId;
      if (!checkpointId) continue;

      replayableBatches.push({
        batchId: batch.batchId,
        checkpointId,
        failedJobs: batch._count.id,
        totalJobs: jobs.length,
        lastFailedAt: batch._max.completedAt || new Date(),
      });
    }

    return replayableBatches.sort((a, b) => b.lastFailedAt.getTime() - a.lastFailedAt.getTime());
  }

  /**
   * Cancel a batch (prevent replay)
   */
  static async cancelBatch(
    batchId: string,
    reason: string
  ): Promise<{ cancelled: number }> {
    await AuditLogger.log({
      operation: 'BATCH_CANCEL',
      entity_type: 'batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { reason },
    });

    const result = await prisma.qBSyncQueue.updateMany({
      where: {
        batchId,
        status: { in: ['pending', 'failed'] },
      },
      data: {
        status: 'cancelled',
        errorMessage: `Cancelled by admin: ${reason}`,
      },
    });

    return { cancelled: result.count };
  }

  /**
   * Get batch status summary
   */
  static async getBatchStatus(
    batchId: string
  ): Promise<{
    batchId: string;
    checkpointId: string | null;
    totalJobs: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const jobs = await prisma.qBSyncQueue.findMany({
      where: { batchId },
      select: {
        status: true,
        checkpointId: true,
      },
    });

    if (jobs.length === 0) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const checkpointId = jobs[0].checkpointId;

    const statusCounts = jobs.reduce(
      (acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      batchId,
      checkpointId,
      totalJobs: jobs.length,
      pending: statusCounts.pending || 0,
      processing: statusCounts.processing || 0,
      completed: statusCounts.completed || 0,
      failed: statusCounts.failed || 0,
      cancelled: statusCounts.cancelled || 0,
    };
  }
}
