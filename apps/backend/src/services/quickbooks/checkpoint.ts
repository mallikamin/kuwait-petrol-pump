/**
 * QuickBooks Checkpoint Service
 *
 * Rule 4: Backups before every sync window
 * - Creates DB checkpoints before write batches
 * - Enables rollback if sync fails
 * - Tracks checkpoint metadata
 */

import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export interface Checkpoint {
  id: string;
  organizationId: string;
  batchId: string;
  backupPath: string;
  backupSize: number;
  checksum: string;
  createdAt: Date;
}

/**
 * Create a database checkpoint before executing write batch
 *
 * MANDATORY before ANY QB write operation
 *
 * @param batchId - Sync batch about to be executed
 * @param organizationId - Organization ID
 * @returns Checkpoint ID
 */
export async function createCheckpoint(
  batchId: string,
  organizationId: string
): Promise<string> {
  const checkpointId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `/root/backups/checkpoint-${checkpointId}-${timestamp}.sql.gz`;

  console.log(`📸 Creating checkpoint ${checkpointId} for batch ${batchId}...`);

  try {
    // Create pg_dump backup
    const { stdout, stderr } = await execAsync(
      `docker exec kuwaitpos-postgres pg_dump -U postgres kuwait_pos | gzip > ${backupPath}`
    );

    if (stderr && !stderr.includes('WARNING')) {
      throw new Error(`Backup failed: ${stderr}`);
    }

    // Get backup file size
    const { stdout: lsOutput } = await execAsync(`ls -l ${backupPath} | awk '{print $5}'`);
    const backupSize = parseInt(lsOutput.trim(), 10);

    if (backupSize < 1000) {
      throw new Error(`Backup file too small (${backupSize} bytes) - likely failed`);
    }

    // Calculate checksum
    const { stdout: checksumOutput } = await execAsync(`sha256sum ${backupPath} | awk '{print $1}'`);
    const checksum = checksumOutput.trim();

    // Link checkpoint to batch in sync queue
    await prisma.qBSyncQueue.updateMany({
      where: { batchId, organizationId },
      data: { checkpointId }
    });

    console.log(
      `✅ Checkpoint created: ${checkpointId} (${(backupSize / 1024 / 1024).toFixed(2)} MB)`
    );

    return checkpointId;
  } catch (error) {
    console.error(`❌ Checkpoint creation failed:`, error);
    throw new Error(`Failed to create checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Restore database from checkpoint
 *
 * Use this when sync batch fails and needs rollback
 *
 * @param checkpointId - Checkpoint to restore from
 */
export async function restoreFromCheckpoint(checkpointId: string): Promise<void> {
  console.log(`🔄 Restoring from checkpoint ${checkpointId}...`);

  try {
    // Find checkpoint backup path
    const jobs = await prisma.qBSyncQueue.findMany({
      where: { checkpointId },
      select: { batchId: true, organizationId: true },
      take: 1
    });

    if (jobs.length === 0) {
      throw new Error(`No jobs found for checkpoint ${checkpointId}`);
    }

    // Find backup file
    const { stdout: findOutput } = await execAsync(
      `ls -t /root/backups/checkpoint-${checkpointId}-*.sql.gz | head -1`
    );
    const backupPath = findOutput.trim();

    if (!backupPath) {
      throw new Error(`Backup file not found for checkpoint ${checkpointId}`);
    }

    // Stop backend temporarily (to close DB connections)
    console.log('⏸️  Stopping backend...');
    await execAsync('docker compose -f docker-compose.prod.yml stop backend');

    // Restore database
    console.log(`📥 Restoring from ${backupPath}...`);
    await execAsync(
      `gunzip -c ${backupPath} | docker exec -i kuwaitpos-postgres psql -U postgres kuwait_pos`
    );

    // Restart backend
    console.log('▶️  Starting backend...');
    await execAsync('docker compose -f docker-compose.prod.yml start backend');

    // Wait for backend health
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(`✅ Database restored from checkpoint ${checkpointId}`);
  } catch (error) {
    console.error(`❌ Restore failed:`, error);
    throw new Error(`Failed to restore checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List all checkpoints for a batch
 */
export async function listCheckpoints(batchId: string): Promise<Checkpoint[]> {
  const jobs = await prisma.qBSyncQueue.findMany({
    where: { batchId },
    select: {
      checkpointId: true,
      organizationId: true,
      createdAt: true
    },
    distinct: ['checkpointId']
  });

  const checkpoints: Checkpoint[] = [];

  for (const job of jobs) {
    if (!job.checkpointId) continue;

    try {
      const { stdout: findOutput } = await execAsync(
        `ls -lt /root/backups/checkpoint-${job.checkpointId}-*.sql.gz | head -1`
      );
      const backupPath = findOutput.trim().split(/\s+/).slice(-1)[0];

      const { stdout: sizeOutput } = await execAsync(`ls -l ${backupPath} | awk '{print $5}'`);
      const backupSize = parseInt(sizeOutput.trim(), 10);

      const { stdout: checksumOutput } = await execAsync(
        `sha256sum ${backupPath} | awk '{print $1}'`
      );
      const checksum = checksumOutput.trim();

      checkpoints.push({
        id: job.checkpointId,
        organizationId: job.organizationId,
        batchId,
        backupPath,
        backupSize,
        checksum,
        createdAt: job.createdAt
      });
    } catch (error) {
      console.warn(`Could not stat checkpoint ${job.checkpointId}:`, error);
    }
  }

  return checkpoints;
}

/**
 * Cleanup old checkpoints (older than 30 days)
 *
 * Run this as a cron job to manage disk space
 */
export async function cleanupOldCheckpoints(): Promise<number> {
  console.log('🧹 Cleaning up old checkpoints...');

  try {
    const { stdout } = await execAsync(
      `find /root/backups -name "checkpoint-*.sql.gz" -mtime +30 -delete -print`
    );

    const deletedFiles = stdout.trim().split('\n').filter(Boolean);
    console.log(`✅ Deleted ${deletedFiles.length} old checkpoints`);

    return deletedFiles.length;
  } catch (error) {
    console.error('❌ Checkpoint cleanup failed:', error);
    return 0;
  }
}

/**
 * Verify checkpoint integrity
 *
 * Checks if backup file exists and is valid
 */
export async function verifyCheckpoint(checkpointId: string): Promise<boolean> {
  try {
    const { stdout: findOutput } = await execAsync(
      `ls /root/backups/checkpoint-${checkpointId}-*.sql.gz | head -1`
    );
    const backupPath = findOutput.trim();

    if (!backupPath) {
      return false;
    }

    // Test gunzip (verify not corrupted)
    await execAsync(`gunzip -t ${backupPath}`);

    // Check file size > 1KB
    const { stdout: sizeOutput } = await execAsync(`ls -l ${backupPath} | awk '{print $5}'`);
    const size = parseInt(sizeOutput.trim(), 10);

    return size > 1000;
  } catch (error) {
    return false;
  }
}
