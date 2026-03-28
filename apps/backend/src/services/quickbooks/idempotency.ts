/**
 * QuickBooks Idempotency Service
 *
 * Rule 2: Never overwrite, only append + version
 * - Prevents duplicate operations
 * - Enforces versioning
 * - Detects conflicts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class IdempotencyError extends Error {
  constructor(
    message: string,
    public idempotencyKey: string,
    public existingJobId?: string
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

/**
 * Generate idempotency key
 *
 * Format: {entity_type}:{local_id}:{operation}:{version}
 * Example: sale:abc-123:create_receipt:1
 */
export function generateIdempotencyKey(
  entityType: string,
  entityId: string,
  operation: string,
  version: number
): string {
  return `${entityType}:${entityId}:${operation}:${version}`;
}

/**
 * Check if operation already exists (idempotency check)
 *
 * @returns Existing job ID if duplicate, null if new operation
 */
export async function checkIdempotency(
  organizationId: string,
  idempotencyKey: string
): Promise<string | null> {
  const existing = await prisma.qBSyncQueue.findFirst({
    where: {
      organizationId,
      idempotencyKey,
      status: { in: ['pending', 'processing', 'completed'] }
    },
    select: { id: true, status: true }
  });

  if (existing) {
    return existing.id;
  }

  return null;
}

/**
 * Create sync job with idempotency protection
 *
 * @throws {IdempotencyError} if duplicate operation detected
 */
export async function createIdempotentJob(params: {
  connectionId: string;
  organizationId: string;
  jobType: string;
  entityType: string;
  entityId: string;
  operation: string;
  version: number;
  payload: Record<string, any>;
  batchId?: string;
  priority?: number;
}) {
  const { organizationId, entityType, entityId, operation, version, batchId, ...rest } = params;

  // Generate idempotency key
  const idempotencyKey = generateIdempotencyKey(entityType, entityId, operation, version);

  // Check for duplicates
  const existingJobId = await checkIdempotency(organizationId, idempotencyKey);

  if (existingJobId) {
    throw new IdempotencyError(
      `Duplicate operation detected: ${idempotencyKey}`,
      idempotencyKey,
      existingJobId
    );
  }

  // Create job with idempotency key
  const job = await prisma.qBSyncQueue.create({
    data: {
      ...rest,
      organizationId,
      entityType,
      entityId,
      idempotencyKey,
      batchId,
      status: 'pending',
      approvalStatus: 'pending_approval'
    }
  });

  console.log(`✅ Created idempotent job: ${job.id} (key: ${idempotencyKey})`);

  return job;
}

/**
 * Get next version number for entity
 *
 * Ensures versions increment sequentially
 */
export async function getNextVersion(
  organizationId: string,
  entityType: string,
  entityId: string
): Promise<number> {
  const lastJob = await prisma.qBSyncQueue.findFirst({
    where: {
      organizationId,
      entityType,
      entityId
    },
    orderBy: { createdAt: 'desc' },
    select: { idempotencyKey: true }
  });

  if (!lastJob || !lastJob.idempotencyKey) {
    return 1;
  }

  // Parse version from idempotency key
  const parts = lastJob.idempotencyKey.split(':');
  const lastVersion = parseInt(parts[3] || '0', 10);

  return lastVersion + 1;
}

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string): boolean {
  const parts = key.split(':');

  if (parts.length !== 4) {
    return false;
  }

  const [entityType, entityId, operation, versionStr] = parts;

  if (!entityType || !entityId || !operation || !versionStr) {
    return false;
  }

  const version = parseInt(versionStr, 10);

  if (isNaN(version) || version < 1) {
    return false;
  }

  return true;
}

/**
 * Find job by idempotency key
 */
export async function findJobByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string
) {
  return prisma.qBSyncQueue.findFirst({
    where: {
      organizationId,
      idempotencyKey
    }
  });
}

/**
 * Mark job as duplicate (if retried)
 */
export async function markAsDuplicate(jobId: string, originalJobId: string) {
  await prisma.qBSyncQueue.update({
    where: { id: jobId },
    data: {
      status: 'cancelled',
      errorMessage: `Duplicate of job ${originalJobId}`
    }
  });

  console.log(`⚠️ Marked job ${jobId} as duplicate of ${originalJobId}`);
}

/**
 * Retry failed job with new version
 *
 * Increments version to avoid idempotency conflict
 */
export async function retryWithNewVersion(jobId: string) {
  const job = await prisma.qBSyncQueue.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (!job.idempotencyKey) {
    throw new Error(`Job ${jobId} has no idempotency key`);
  }

  // Parse current version
  const parts = job.idempotencyKey.split(':');
  const currentVersion = parseInt(parts[3], 10);
  const newVersion = currentVersion + 1;

  // Generate new idempotency key
  const newKey = generateIdempotencyKey(
    job.entityType,
    job.entityId!,
    parts[2],
    newVersion
  );

  // Create new job with incremented version
  const retryJob = await prisma.qBSyncQueue.create({
    data: {
      connectionId: job.connectionId,
      organizationId: job.organizationId,
      jobType: job.jobType,
      entityType: job.entityType,
      entityId: job.entityId,
      priority: job.priority,
      payload: job.payload,
      idempotencyKey: newKey,
      batchId: job.batchId,
      replayableFromBatch: job.batchId,
      status: 'pending',
      approvalStatus: job.approvalStatus,
      maxRetries: job.maxRetries
    }
  });

  console.log(
    `🔄 Retry created: ${retryJob.id} (version ${currentVersion} → ${newVersion})`
  );

  return retryJob;
}
