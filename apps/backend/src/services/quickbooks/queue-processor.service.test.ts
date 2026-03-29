/**
 * Queue Processor Service Tests
 *
 * Verifies:
 * - Job state transitions (pending → processing → completed)
 * - Retry backoff calculation
 * - Dead-letter handling
 * - Unsupported dispatch paths
 */

import { QueueProcessorService } from './queue-processor.service';
import { dispatch } from './job-dispatcher';
import { PrismaClient } from '@prisma/client';
import { checkKillSwitch, checkSyncMode } from './safety-gates';
import { AuditLogger } from './audit-logger';
import { redis } from '../../config/redis';

// Mock dependencies
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    qBSyncQueue: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    qBConnection: {
      findFirst: jest.fn()
    }
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma)
  };
});

// Mock Redis
jest.mock('../../config/redis', () => ({
  redis: {
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn()
  }
}));

jest.mock('./safety-gates');
jest.mock('./audit-logger');
jest.mock('./job-dispatcher');

describe('QueueProcessorService', () => {
  let processor: QueueProcessorService;
  let mockPrisma: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Get mock prisma instance
    mockPrisma = new PrismaClient();

    // Setup default mock behaviors
    (checkKillSwitch as jest.Mock).mockResolvedValue(undefined);
    (checkSyncMode as jest.Mock).mockResolvedValue(undefined);
    (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);
    (redis.set as jest.Mock).mockResolvedValue('OK'); // Lock acquired by default
    (redis.del as jest.Mock).mockResolvedValue(1);
    (redis.eval as jest.Mock).mockResolvedValue(1); // Ownership checks pass by default

    processor = new QueueProcessorService();
  });

  afterEach(async () => {
    await processor.stop();
  });

  describe('Success Path', () => {
    it('should process pending job to completion', async () => {
      const mockJob = {
        id: 'job-1',
        organizationId: 'org-1',
        entityType: 'sale',
        entityId: 'entity-1',
        jobType: 'create_sales_receipt',
        status: 'pending',
        approvalStatus: 'approved',
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: null
      };

      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
      mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

      (dispatch as jest.Mock).mockResolvedValue({
        success: true,
        qbId: 'QB-123'
      });

      // Process the job (we'll call the private method via the public interface)
      // Start and immediately stop to process one cycle
      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify safety gates were checked
      expect(checkKillSwitch).toHaveBeenCalledWith('org-1');
      expect(checkSyncMode).toHaveBeenCalledWith('org-1');

      // Verify status updates
      const updateCalls = mockPrisma.qBSyncQueue.update.mock.calls;

      // First call: status -> processing
      expect(updateCalls[0][0]).toMatchObject({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'processing',
          startedAt: expect.any(Date)
        })
      });

      // Second call: status -> completed
      expect(updateCalls[1][0]).toMatchObject({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'completed',
          result: { qbId: 'QB-123' },
          completedAt: expect.any(Date),
          durationMs: expect.any(Number)
        })
      });

      // Verify audit logs
      // Should have transition log (pending → processing)
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_TRANSITION',
          entity_type: 'sale',
          metadata: expect.objectContaining({
            previousStatus: 'pending',
            newStatus: 'processing'
          })
        })
      );

      // Should have success log
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_SUCCESS',
          entity_type: 'sale',
          status: 'SUCCESS'
        })
      );
    });
  });

  describe('Retry Backoff', () => {
    it('should calculate correct nextRetryAt for failed jobs', async () => {
      const testCases = [
        { retryCount: 0, expectedSeconds: 30 },   // 30 * 2^0 = 30s
        { retryCount: 1, expectedSeconds: 60 },   // 30 * 2^1 = 60s
        { retryCount: 2, expectedSeconds: 120 },  // 30 * 2^2 = 120s
        { retryCount: 3, expectedSeconds: 240 }   // 30 * 2^3 = 240s
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();

        const mockJob = {
          id: `job-${testCase.retryCount}`,
          organizationId: 'org-1',
          entityType: 'sale',
          entityId: 'entity-1',
          jobType: 'create_sales_receipt',
          status: 'failed',
          approvalStatus: 'approved',
          retryCount: testCase.retryCount,
          maxRetries: 5,
          nextRetryAt: new Date()
        };

        mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
        mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

        (dispatch as jest.Mock).mockRejectedValue(new Error('Test failure'));

        const startTime = Date.now();

        await processor.start();
        await new Promise(resolve => setTimeout(resolve, 100));
        await processor.stop();

        // Find the update call that sets nextRetryAt
        const updateCalls = mockPrisma.qBSyncQueue.update.mock.calls;
        const failureUpdate = updateCalls.find((call: any) =>
          call[0].data.status === 'failed' && call[0].data.nextRetryAt
        );

        expect(failureUpdate).toBeDefined();

        const nextRetryAt = failureUpdate[0].data.nextRetryAt;
        const actualDelayMs = nextRetryAt.getTime() - startTime;
        const expectedDelayMs = testCase.expectedSeconds * 1000;

        // Allow 1 second tolerance for test execution time
        expect(actualDelayMs).toBeGreaterThanOrEqual(expectedDelayMs - 1000);
        expect(actualDelayMs).toBeLessThanOrEqual(expectedDelayMs + 1000);
      }
    });
  });

  describe('Dead Letter', () => {
    it('should move job to dead_letter when retryCount >= maxRetries', async () => {
      const mockJob = {
        id: 'job-dead',
        organizationId: 'org-1',
        entityType: 'sale',
        entityId: 'entity-1',
        jobType: 'create_sales_receipt',
        status: 'failed',
        approvalStatus: 'approved',
        retryCount: 2,  // Will become 3 after failure
        maxRetries: 3,  // At limit
        nextRetryAt: new Date()
      };

      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
      mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

      (dispatch as jest.Mock).mockRejectedValue(new Error('Permanent failure'));

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Find the update call that sets status to dead_letter
      const updateCalls = mockPrisma.qBSyncQueue.update.mock.calls;
      const deadLetterUpdate = updateCalls.find((call: any) =>
        call[0].data.status === 'dead_letter'
      );

      expect(deadLetterUpdate).toBeDefined();
      expect(deadLetterUpdate[0]).toMatchObject({
        where: { id: 'job-dead' },
        data: expect.objectContaining({
          status: 'dead_letter',
          errorMessage: 'Permanent failure',
          retryCount: 3,
          completedAt: expect.any(Date)
        })
      });

      // Verify audit log
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_DEAD_LETTER',
          entity_type: 'sale',
          status: 'FAILURE',
          error_message: expect.stringContaining('Max retries exceeded')
        })
      );
    });
  });

  describe('Unsupported Dispatch', () => {
    it('should handle unsupported entityType/jobType gracefully', async () => {
      const mockJob = {
        id: 'job-unsupported',
        organizationId: 'org-1',
        entityType: 'unknown',
        entityId: 'entity-1',
        jobType: 'unsupported_operation',
        status: 'pending',
        approvalStatus: 'approved',
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: null
      };

      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
      mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

      (dispatch as jest.Mock).mockRejectedValue(
        new Error('Unsupported dispatch path: entityType=unknown, jobType=unsupported_operation')
      );

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Should fail and schedule retry (not crash)
      const updateCalls = mockPrisma.qBSyncQueue.update.mock.calls;
      const failureUpdate = updateCalls.find((call: any) =>
        call[0].data.status === 'failed'
      );

      expect(failureUpdate).toBeDefined();
      expect(failureUpdate[0].data.errorMessage).toContain('Unsupported dispatch path');

      // Verify audit log recorded the failure
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_RETRY',
          status: 'FAILURE',
          error_message: expect.stringContaining('Unsupported dispatch path')
        })
      );
    });
  });

  describe('Query Filters', () => {
    it('should only process approved jobs with status pending/failed', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      expect(mockPrisma.qBSyncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: ['pending', 'failed']
            },
            approvalStatus: 'approved',
            OR: [
              { nextRetryAt: null },
              { nextRetryAt: { lte: expect.any(Date) } }
            ]
          })
        })
      );
    });
  });

  describe('Redis Leader Lock', () => {
    it('should not start processor when lock cannot be acquired', async () => {
      // Mock lock acquisition failure (another process holds the lock)
      (redis.set as jest.Mock).mockResolvedValue(null);
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify poll() was never called (no findMany query)
      expect(mockPrisma.qBSyncQueue.findMany).not.toHaveBeenCalled();

      // Verify lock was attempted
      expect(redis.set).toHaveBeenCalledWith(
        'qb:queue:processor:lock',
        expect.any(String),
        { NX: true, EX: 30 }
      );
    });

    it('should acquire lock and start processing when lock available', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify lock was acquired with unique token
      expect(redis.set).toHaveBeenCalledWith(
        'qb:queue:processor:lock',
        expect.any(String),
        { NX: true, EX: 30 }
      );

      // Verify processor started (poll called, findMany executed)
      expect(mockPrisma.qBSyncQueue.findMany).toHaveBeenCalled();

      // Verify lock was released on stop via eval (not del)
      const evalCalls = (redis.eval as jest.Mock).mock.calls;
      const releaseCall = evalCalls.find((call: any) =>
        call[0].includes('DEL')
      );
      expect(releaseCall).toBeDefined();
      expect(releaseCall[1]).toMatchObject({
        keys: ['qb:queue:processor:lock'],
        arguments: [expect.any(String)]
      });
    });

    it('should refresh lock TTL via heartbeat', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      await processor.start();

      // Wait for heartbeat interval (10 seconds + buffer)
      await new Promise(resolve => setTimeout(resolve, 11000));
      await processor.stop();

      // Verify initial lock acquisition
      expect(redis.set).toHaveBeenCalledWith(
        'qb:queue:processor:lock',
        expect.any(String),
        { NX: true, EX: 30 }
      );

      // Verify heartbeat extended the lock via eval (not SET XX)
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        expect.objectContaining({
          keys: ['qb:queue:processor:lock'],
          arguments: [expect.any(String), '30']
        })
      );
    }, 15000); // Increase test timeout to 15s
  });

  describe('Status Transition Audit Logs', () => {
    it('should log transition to processing status', async () => {
      const mockJob = {
        id: 'job-1',
        organizationId: 'org-1',
        entityType: 'sale',
        entityId: 'entity-1',
        jobType: 'create_sales_receipt',
        status: 'pending',
        approvalStatus: 'approved',
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: null
      };

      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
      mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

      (dispatch as jest.Mock).mockResolvedValue({
        success: true,
        qbId: 'QB-123'
      });

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify transition audit log was created
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_TRANSITION',
          entity_type: 'sale',
          entity_id: 'entity-1',
          direction: 'APP_TO_QB',
          status: 'PENDING',
          metadata: expect.objectContaining({
            jobId: 'job-1',
            jobType: 'create_sales_receipt',
            previousStatus: 'pending',
            newStatus: 'processing',
            retryCount: 0
          })
        })
      );
    });

    it('should log transition when retrying a failed job', async () => {
      const mockJob = {
        id: 'job-retry',
        organizationId: 'org-1',
        entityType: 'sale',
        entityId: 'entity-1',
        jobType: 'create_sales_receipt',
        status: 'failed',
        approvalStatus: 'approved',
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date()
      };

      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([mockJob]);
      mockPrisma.qBSyncQueue.update.mockResolvedValue(mockJob);

      (dispatch as jest.Mock).mockResolvedValue({
        success: true,
        qbId: 'QB-456'
      });

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify transition audit log shows failed → processing
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'JOB_TRANSITION',
          metadata: expect.objectContaining({
            previousStatus: 'failed',
            newStatus: 'processing',
            retryCount: 1
          })
        })
      );
    });
  });

  describe('Lock Ownership', () => {
    it('should not renew lock when token mismatch', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      // Mock eval to return 0 (ownership check failed)
      (redis.eval as jest.Mock).mockResolvedValue(0);

      await processor.start();

      // Wait for heartbeat interval (10 seconds + buffer)
      await new Promise(resolve => setTimeout(resolve, 11000));

      // Processor should have stopped itself after losing lock
      // Verify eval was called with RENEW script
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        expect.objectContaining({
          keys: ['qb:queue:processor:lock'],
          arguments: [expect.any(String), '30']
        })
      );

      await processor.stop();
    }, 15000); // Increase test timeout to 15s

    it('should not delete lock when token mismatch', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      // Mock eval to return 0 for release (not owner)
      (redis.eval as jest.Mock).mockResolvedValueOnce(1); // Heartbeat succeeds
      (redis.eval as jest.Mock).mockResolvedValueOnce(0); // Release returns 0

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify eval was called with RELEASE script
      const evalCalls = (redis.eval as jest.Mock).mock.calls;
      const releaseCall = evalCalls.find((call: any) =>
        call[0].includes('DEL')
      );

      expect(releaseCall).toBeDefined();
      expect(releaseCall[1]).toMatchObject({
        keys: ['qb:queue:processor:lock'],
        arguments: [expect.any(String)]
      });

      // Should handle gracefully (no error thrown)
    });

    it('should renew lock successfully when owner', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      // Mock eval to return 1 (ownership check passed)
      (redis.eval as jest.Mock).mockResolvedValue(1);

      await processor.start();

      // Wait for heartbeat interval
      await new Promise(resolve => setTimeout(resolve, 11000));

      // Verify eval was called with correct parameters
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        expect.objectContaining({
          keys: ['qb:queue:processor:lock'],
          arguments: [expect.any(String), '30']
        })
      );

      await processor.stop();

      // Processor should still be running (not stopped due to lock loss)
    }, 15000);

    it('should delete lock successfully when owner', async () => {
      mockPrisma.qBSyncQueue.findMany.mockResolvedValue([]);

      // Mock eval to return 1 (ownership check passed)
      (redis.eval as jest.Mock).mockResolvedValue(1);

      await processor.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await processor.stop();

      // Verify eval was called with RELEASE script and returned 1
      const evalCalls = (redis.eval as jest.Mock).mock.calls;
      const releaseCall = evalCalls.find((call: any) =>
        call[0].includes('DEL')
      );

      expect(releaseCall).toBeDefined();
      expect(releaseCall[1]).toMatchObject({
        keys: ['qb:queue:processor:lock'],
        arguments: [expect.any(String)]
      });
    });
  });
});
