/**
 * QuickBooks Queue Processor Service
 *
 * Polls QBSyncQueue for pending/failed jobs and executes them
 * Implements retry backoff, dead-letter handling, and safety gate checks
 * Uses Redis-based leader lock to prevent concurrent processing across replicas
 */

import { PrismaClient } from '@prisma/client';
import { checkKillSwitch, checkSyncMode } from './safety-gates';
import { AuditLogger } from './audit-logger';
import { dispatch, JobResult } from './job-dispatcher';
import { redis } from '../../config/redis';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// Redis lock configuration
const LOCK_KEY = 'qb:queue:processor:lock';
const LOCK_TTL = 30; // seconds
const HEARTBEAT_INTERVAL = 10000; // 10 seconds (refresh lock before expiry)

// Lua scripts for atomic lock operations with ownership checks
// Renew lock only if current value matches our token (prevents overwriting another replica's lock)
const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

// Release lock only if current value matches our token (prevents deleting another replica's lock)
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export class QueueProcessorService {
  private isRunning = false;
  private pollInterval = 10000; // 10 seconds
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private hasLock = false;
  private lockToken: string; // Unique token for ownership verification

  constructor() {
    // Generate unique token for this processor instance
    this.lockToken = randomUUID();
  }

  /**
   * Start the queue processor (begins polling loop)
   * Acquires Redis lock to ensure single-process execution
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[QB Queue Processor] Already running');
      return;
    }

    // Try to acquire leader lock
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      console.warn('[QB Queue Processor] Could not acquire lock - another process is already running');
      return;
    }

    this.isRunning = true;
    this.hasLock = true;
    console.log('[QB Queue Processor] Starting with leader lock acquired...');

    // Start heartbeat to maintain lock
    this.startHeartbeat();

    // Start polling loop
    this.poll();
  }

  /**
   * Stop the queue processor (graceful shutdown)
   * Releases Redis lock
   */
  async stop(): Promise<void> {
    console.log('[QB Queue Processor] Stopping...');
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Release lock
    if (this.hasLock) {
      await this.releaseLock();
      this.hasLock = false;
    }

    console.log('[QB Queue Processor] Stopped');
  }

  /**
   * Poll for jobs and process them
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.processNextBatch();
    } catch (error) {
      // Don't crash the polling loop on error
      console.error('[QB Queue Processor] Poll cycle error:', error);
      await AuditLogger.log({
        operation: 'PROCESSOR_ERROR',
        entity_type: 'queue',
        direction: 'APP_TO_QB',
        status: 'FAILURE',
        error_message: error instanceof Error ? error.message : String(error)
      });
    }

    // Schedule next poll
    this.timer = setTimeout(() => this.poll(), this.pollInterval);
  }

  /**
   * Process a batch of pending/failed jobs
   */
  private async processNextBatch(): Promise<void> {
    // Query for jobs ready to process
    const jobs = await prisma.qBSyncQueue.findMany({
      where: {
        status: {
          in: ['pending', 'failed']
        },
        approvalStatus: 'approved',
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: new Date() } }
        ]
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' }
      ],
      take: 10 // Process up to 10 jobs per cycle
    });

    if (jobs.length === 0) {
      return;
    }

    console.log(`[QB Queue Processor] Processing ${jobs.length} jobs`);

    // Process each job
    for (const job of jobs) {
      try {
        await this.processJob(job);
      } catch (error) {
        // Log but continue processing other jobs
        console.error(`[QB Queue Processor] Failed to process job ${job.id}:`, error);
      }
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: any): Promise<void> {
    const startTime = Date.now();
    const previousStatus = job.status;

    try {
      // Check safety gates before execution
      await checkKillSwitch(job.organizationId);
      await checkSyncMode(job.organizationId);

      // Update status to processing
      await prisma.qBSyncQueue.update({
        where: { id: job.id },
        data: {
          status: 'processing',
          startedAt: new Date()
        }
      });

      // Audit log: status transition to processing
      await AuditLogger.log({
        operation: 'JOB_TRANSITION',
        entity_type: job.entityType,
        entity_id: job.entityId || job.id,
        direction: 'APP_TO_QB',
        status: 'PENDING',
        metadata: {
          jobId: job.id,
          jobType: job.jobType,
          previousStatus,
          newStatus: 'processing',
          retryCount: job.retryCount
        }
      });

      // Dispatch to appropriate handler
      const result: JobResult = await dispatch(job);

      // Calculate duration
      const durationMs = Date.now() - startTime;

      if (result.success) {
        // Mark as completed
        await prisma.qBSyncQueue.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            result: { qbId: result.qbId },
            completedAt: new Date(),
            durationMs
          }
        });

        // Log success
        await AuditLogger.log({
          operation: 'JOB_SUCCESS',
          entity_type: job.entityType,
          entity_id: job.entityId || job.id,
          direction: 'APP_TO_QB',
          status: 'SUCCESS',
          metadata: {
            jobId: job.id,
            jobType: job.jobType,
            qbId: result.qbId,
            durationMs
          }
        });

        console.log(`[QB Queue Processor] Job ${job.id} completed successfully`);
      } else {
        throw new Error(result.error || 'Job failed without error message');
      }
    } catch (error) {
      await this.handleJobFailure(job, error as Error, startTime);
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(job: any, error: Error, startTime: number): Promise<void> {
    const durationMs = Date.now() - startTime;
    const newRetryCount = job.retryCount + 1;

    // Check if should move to dead letter
    if (newRetryCount >= job.maxRetries) {
      await prisma.qBSyncQueue.update({
        where: { id: job.id },
        data: {
          status: 'dead_letter',
          errorMessage: error.message,
          retryCount: newRetryCount,
          completedAt: new Date(),
          durationMs
        }
      });

      await AuditLogger.log({
        operation: 'JOB_DEAD_LETTER',
        entity_type: job.entityType,
        entity_id: job.entityId || job.id,
        direction: 'APP_TO_QB',
        status: 'FAILURE',
        error_message: `Max retries exceeded: ${error.message}`,
        metadata: {
          jobId: job.id,
          jobType: job.jobType,
          retryCount: newRetryCount,
          maxRetries: job.maxRetries
        }
      });

      console.log(`[QB Queue Processor] Job ${job.id} moved to dead letter (max retries: ${job.maxRetries})`);
    } else {
      // Calculate next retry time with exponential backoff
      const backoffSeconds = 30 * Math.pow(2, job.retryCount);
      const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

      await prisma.qBSyncQueue.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
          retryCount: newRetryCount,
          nextRetryAt,
          durationMs
        }
      });

      await AuditLogger.log({
        operation: 'JOB_RETRY',
        entity_type: job.entityType,
        entity_id: job.entityId || job.id,
        direction: 'APP_TO_QB',
        status: 'FAILURE',
        error_message: error.message,
        metadata: {
          jobId: job.id,
          jobType: job.jobType,
          retryCount: newRetryCount,
          nextRetryAt,
          backoffSeconds
        }
      });

      console.log(
        `[QB Queue Processor] Job ${job.id} failed, retry ${newRetryCount}/${job.maxRetries} scheduled for ${nextRetryAt.toISOString()}`
      );
    }
  }

  /**
   * Acquire Redis leader lock (SET NX EX)
   * Returns true if lock acquired, false if already held by another process
   * Uses unique token for ownership verification
   */
  private async acquireLock(): Promise<boolean> {
    try {
      const result = await redis.set(LOCK_KEY, this.lockToken, {
        NX: true,
        EX: LOCK_TTL
      });
      return result === 'OK';
    } catch (error) {
      console.error('[QB Queue Processor] Failed to acquire lock:', error);
      return false;
    }
  }

  /**
   * Start heartbeat loop to refresh lock TTL
   * Uses Lua script to atomically check ownership before extending TTL
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (!this.hasLock || !this.isRunning) {
        return;
      }

      try {
        // Atomically check ownership and extend lock TTL
        // Returns 1 if lock was extended, 0 if we don't own the lock
        const result = await redis.eval(
          RENEW_LOCK_SCRIPT,
          {
            keys: [LOCK_KEY],
            arguments: [this.lockToken, LOCK_TTL.toString()]
          }
        ) as number;

        if (result === 0) {
          // Lost lock ownership - another replica took over
          console.error('[QB Queue Processor] Lost lock ownership - stopping processor');
          this.isRunning = false;
          this.hasLock = false;

          // Clear timers immediately
          if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
        } else {
          console.log('[QB Queue Processor] Lock heartbeat successful');
        }
      } catch (error) {
        console.error('[QB Queue Processor] Lock heartbeat failed:', error);
        // If heartbeat fails, stop processing to avoid split-brain
        this.isRunning = false;
        this.hasLock = false;
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Release Redis leader lock (DEL key)
   * Uses Lua script to atomically check ownership before deleting
   */
  private async releaseLock(): Promise<void> {
    try {
      // Atomically check ownership and delete lock
      // Returns 1 if lock was deleted, 0 if we don't own the lock
      const result = await redis.eval(
        RELEASE_LOCK_SCRIPT,
        {
          keys: [LOCK_KEY],
          arguments: [this.lockToken]
        }
      ) as number;

      if (result === 1) {
        console.log('[QB Queue Processor] Lock released');
      } else {
        console.warn('[QB Queue Processor] Lock already released or owned by another process');
      }
    } catch (error) {
      console.error('[QB Queue Processor] Failed to release lock:', error);
    }
  }
}

// Export singleton instance
export const queueProcessor = new QueueProcessorService();
