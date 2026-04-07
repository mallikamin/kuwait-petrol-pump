/**
 * Mapping Batch Service
 * Manages batch operations for QB mapping undo/revert functionality
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface BatchSummary {
  id: string;
  batchType: string;
  description: string | null;
  createdAt: Date;
  createdBy: string;
  isReverted: boolean;
  mappingCount: number;
}

export interface BatchPreview {
  id: string;
  batchType: string;
  description: string | null;
  createdAt: Date;
  isReverted: boolean;
  changes: Array<{
    entityType: string;
    localId: string;
    operation: string;
    before: {
      qbId: string | null;
      qbName: string | null;
      isActive: boolean | null;
    };
    after: {
      qbId: string | null;
      qbName: string | null;
      isActive: boolean | null;
    };
  }>;
}

export interface RevertResult {
  success: boolean;
  revertedCount: number;
  errors: Array<{ localId: string; error: string }>;
}

export class MappingBatchService {
  /**
   * Create a new batch to group related mapping operations
   */
  static async createBatch(
    organizationId: string,
    userId: string,
    batchType: 'auto_match' | 'manual_edit' | 'bulk_import',
    description?: string
  ): Promise<string> {
    const batch = await prisma.qBMappingBatch.create({
      data: {
        organizationId,
        createdBy: userId,
        batchType,
        description: description || `${batchType} at ${new Date().toISOString()}`,
      },
    });
    return batch.id;
  }

  /**
   * List recent batches (for "Undo Last Apply" UI)
   */
  static async getRecentBatches(
    organizationId: string,
    limit: number = 10
  ): Promise<BatchSummary[]> {
    const batches = await prisma.qBMappingBatch.findMany({
      where: { organizationId, isReverted: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: {
          select: { historyEntries: true },
        },
      },
    });

    return batches.map((b) => ({
      id: b.id,
      batchType: b.batchType,
      description: b.description,
      createdAt: b.createdAt,
      createdBy: b.createdBy,
      isReverted: b.isReverted,
      mappingCount: b._count.historyEntries,
    }));
  }

  /**
   * Get preview of what will be reverted
   */
  static async getBatchPreview(batchId: string, organizationId: string): Promise<BatchPreview> {
    const batch = await prisma.qBMappingBatch.findUnique({
      where: { id: batchId },
      include: { historyEntries: true },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    if (batch.organizationId !== organizationId) {
      throw new Error('Unauthorized');
    }

    const changes = batch.historyEntries.map((entry) => ({
      entityType: entry.entityType,
      localId: entry.localId,
      operation: entry.operation,
      before: {
        qbId: entry.beforeQbId,
        qbName: entry.beforeQbName,
        isActive: entry.beforeIsActive,
      },
      after: {
        qbId: entry.afterQbId,
        qbName: entry.afterQbName,
        isActive: entry.afterIsActive,
      },
    }));

    return {
      id: batch.id,
      batchType: batch.batchType,
      description: batch.description,
      createdAt: batch.createdAt,
      isReverted: batch.isReverted,
      changes,
    };
  }

  /**
   * Revert a batch (restore all mappings to before state)
   */
  static async revertBatch(
    batchId: string,
    organizationId: string,
    userId: string
  ): Promise<RevertResult> {
    // Verify batch exists and belongs to org
    const batch = await prisma.qBMappingBatch.findUnique({
      where: { id: batchId },
      include: { historyEntries: true },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    if (batch.organizationId !== organizationId) {
      throw new Error('Unauthorized');
    }

    if (batch.isReverted) {
      throw new Error('Batch already reverted');
    }

    let revertedCount = 0;
    const errors: Array<{ localId: string; error: string }> = [];

    // Revert each history entry
    for (const historyEntry of batch.historyEntries) {
      try {
        if (historyEntry.operation === 'CREATE') {
          // Newly created mapping → deactivate it
          await prisma.qBEntityMapping.updateMany({
            where: {
              organizationId,
              entityType: historyEntry.entityType,
              localId: historyEntry.localId,
            },
            data: { isActive: false },
          });
        } else if (historyEntry.operation === 'UPDATE') {
          // Updated mapping → restore previous qbId/qbName
          if (!historyEntry.beforeQbId) {
            errors.push({
              localId: historyEntry.localId,
              error: 'No before state (orphaned history entry)',
            });
            continue;
          }

          await prisma.qBEntityMapping.updateMany({
            where: {
              organizationId,
              entityType: historyEntry.entityType,
              localId: historyEntry.localId,
            },
            data: {
              qbId: historyEntry.beforeQbId,
              qbName: historyEntry.beforeQbName,
              isActive: historyEntry.beforeIsActive ?? true,
            },
          });
        } else if (historyEntry.operation === 'DEACTIVATE') {
          // Deactivated mapping → re-activate with previous state
          if (!historyEntry.beforeQbId) {
            errors.push({
              localId: historyEntry.localId,
              error: 'No before state to restore',
            });
            continue;
          }

          await prisma.qBEntityMapping.updateMany({
            where: {
              organizationId,
              entityType: historyEntry.entityType,
              localId: historyEntry.localId,
            },
            data: {
              qbId: historyEntry.beforeQbId,
              qbName: historyEntry.beforeQbName,
              isActive: true,
            },
          });
        }

        revertedCount++;
      } catch (err) {
        errors.push({
          localId: historyEntry.localId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Mark batch as reverted
    await prisma.qBMappingBatch.update({
      where: { id: batchId },
      data: {
        isReverted: true,
        revertedAt: new Date(),
        revertedBy: userId,
      },
    });

    return {
      success: errors.length === 0,
      revertedCount,
      errors,
    };
  }
}
