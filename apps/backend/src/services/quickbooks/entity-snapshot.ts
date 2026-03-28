/**
 * QuickBooks Entity Snapshot Service
 *
 * Rule 5: QB fallback snapshots for disaster recovery
 * - Captures full QB entity data before/after sync
 * - Enables restoration from last-known-good state
 * - Tracks entity versions and changes
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export type QBEntityType = 'Customer' | 'Item' | 'Invoice' | 'Payment' | 'Account' | 'SalesReceipt';
export type SnapshotType = 'pre_sync' | 'post_sync' | 'manual' | 'scheduled';

export interface CreateSnapshotParams {
  connectionId: string;
  organizationId: string;
  qbEntityType: QBEntityType;
  qbEntityId: string;
  qbEntityName: string;
  snapshotData: Record<string, any>;
  snapshotType: SnapshotType;
  localEntityType?: string;
  localEntityId?: string;
  snapshotBy?: string;
  notes?: string;
  expiresAt?: Date;
}

/**
 * Create a snapshot of a QB entity
 *
 * Use this before/after every sync operation for audit and rollback
 */
export async function createEntitySnapshot(params: CreateSnapshotParams) {
  const {
    connectionId,
    organizationId,
    qbEntityType,
    qbEntityId,
    qbEntityName,
    snapshotData,
    snapshotType,
    localEntityType,
    localEntityId,
    snapshotBy,
    notes,
    expiresAt
  } = params;

  // Calculate hash for change detection
  const dataString = JSON.stringify(snapshotData);
  const syncHash = crypto.createHash('sha256').update(dataString).digest('hex');

  // Get current version for this entity
  const lastSnapshot = await prisma.qBEntitySnapshot.findFirst({
    where: {
      organizationId,
      qbEntityType,
      qbEntityId
    },
    orderBy: { syncVersion: 'desc' },
    select: { syncVersion: true }
  });

  const syncVersion = (lastSnapshot?.syncVersion || 0) + 1;

  const snapshot = await prisma.qBEntitySnapshot.create({
    data: {
      connectionId,
      organizationId,
      qbEntityType,
      qbEntityId,
      qbEntityName,
      snapshotData,
      syncVersion,
      syncHash,
      snapshotType,
      localEntityType,
      localEntityId,
      snapshotBy,
      notes,
      snapshotAt: new Date(),
      expiresAt
    }
  });

  console.log(
    `📸 Snapshot created: ${qbEntityType} ${qbEntityId} v${syncVersion} (${snapshotType})`
  );

  return snapshot;
}

/**
 * Create pre-sync snapshots for a batch of entities
 *
 * Call this before executing a sync batch
 */
export async function createPreSyncSnapshots(
  connectionId: string,
  organizationId: string,
  entities: Array<{
    qbEntityType: QBEntityType;
    qbEntityId: string;
    qbEntityName: string;
    data: Record<string, any>;
  }>
): Promise<number> {
  console.log(`📸 Creating pre-sync snapshots for ${entities.length} entities...`);

  let created = 0;

  for (const entity of entities) {
    await createEntitySnapshot({
      connectionId,
      organizationId,
      qbEntityType: entity.qbEntityType,
      qbEntityId: entity.qbEntityId,
      qbEntityName: entity.qbEntityName,
      snapshotData: entity.data,
      snapshotType: 'pre_sync',
      notes: 'Auto-created before sync operation'
    });
    created++;
  }

  console.log(`✅ Created ${created} pre-sync snapshots`);
  return created;
}

/**
 * Create post-sync snapshot (after successful sync)
 */
export async function createPostSyncSnapshot(
  connectionId: string,
  organizationId: string,
  qbEntityType: QBEntityType,
  qbEntityId: string,
  qbEntityName: string,
  qbData: Record<string, any>,
  localEntityType?: string,
  localEntityId?: string
) {
  return createEntitySnapshot({
    connectionId,
    organizationId,
    qbEntityType,
    qbEntityId,
    qbEntityName,
    snapshotData: qbData,
    snapshotType: 'post_sync',
    localEntityType,
    localEntityId,
    notes: 'Auto-created after successful sync'
  });
}

/**
 * Get latest snapshot for an entity
 */
export async function getLatestSnapshot(
  organizationId: string,
  qbEntityType: QBEntityType,
  qbEntityId: string
) {
  return prisma.qBEntitySnapshot.findFirst({
    where: {
      organizationId,
      qbEntityType,
      qbEntityId
    },
    orderBy: { syncVersion: 'desc' }
  });
}

/**
 * Get snapshot history for an entity
 */
export async function getSnapshotHistory(
  organizationId: string,
  qbEntityType: QBEntityType,
  qbEntityId: string,
  limit = 10
) {
  return prisma.qBEntitySnapshot.findMany({
    where: {
      organizationId,
      qbEntityType,
      qbEntityId
    },
    orderBy: { syncVersion: 'desc' },
    take: limit
  });
}

/**
 * Compare two snapshots to detect changes
 */
export async function compareSnapshots(
  snapshotId1: string,
  snapshotId2: string
): Promise<{
  hasChanges: boolean;
  hashDiff: boolean;
  versionDiff: number;
  timeDiff: number;
}> {
  const [snap1, snap2] = await Promise.all([
    prisma.qBEntitySnapshot.findUnique({ where: { id: snapshotId1 } }),
    prisma.qBEntitySnapshot.findUnique({ where: { id: snapshotId2 } })
  ]);

  if (!snap1 || !snap2) {
    throw new Error('Snapshot not found');
  }

  const hashDiff = snap1.syncHash !== snap2.syncHash;
  const versionDiff = snap2.syncVersion - snap1.syncVersion;
  const timeDiff = snap2.snapshotAt.getTime() - snap1.snapshotAt.getTime();

  return {
    hasChanges: hashDiff,
    hashDiff,
    versionDiff,
    timeDiff
  };
}

/**
 * Export all QB entity snapshots for organization
 *
 * Use for disaster recovery - exports last known-good state
 */
export async function exportOrganizationSnapshots(
  organizationId: string,
  entityTypes?: QBEntityType[]
): Promise<Record<string, any>> {
  const where: any = {
    organizationId,
    snapshotType: { in: ['post_sync', 'scheduled'] }
  };

  if (entityTypes) {
    where.qbEntityType = { in: entityTypes };
  }

  const snapshots = await prisma.qBEntitySnapshot.findMany({
    where,
    orderBy: [{ qbEntityType: 'asc' }, { syncVersion: 'desc' }],
    distinct: ['qbEntityId', 'qbEntityType']
  });

  const export_data = {
    exportedAt: new Date().toISOString(),
    organizationId,
    totalEntities: snapshots.length,
    entities: snapshots.reduce((acc, snap) => {
      if (!acc[snap.qbEntityType]) {
        acc[snap.qbEntityType] = [];
      }
      acc[snap.qbEntityType].push({
        qbEntityId: snap.qbEntityId,
        qbEntityName: snap.qbEntityName,
        syncVersion: snap.syncVersion,
        snapshotAt: snap.snapshotAt,
        data: snap.snapshotData
      });
      return acc;
    }, {} as Record<string, any[]>)
  };

  console.log(
    `📦 Exported ${snapshots.length} entity snapshots for org ${organizationId}`
  );

  return export_data;
}

/**
 * Restore local entities from QB snapshots
 *
 * Use for disaster recovery when local DB is corrupted
 */
export async function restoreFromSnapshots(
  organizationId: string,
  snapshotDate?: Date
): Promise<number> {
  console.log(
    `🔄 Restoring entities from snapshots${snapshotDate ? ` as of ${snapshotDate.toISOString()}` : ''}...`
  );

  const where: any = {
    organizationId,
    snapshotType: { in: ['post_sync', 'scheduled'] }
  };

  if (snapshotDate) {
    where.snapshotAt = { lte: snapshotDate };
  }

  const snapshots = await prisma.qBEntitySnapshot.findMany({
    where,
    orderBy: [{ qbEntityType: 'asc' }, { syncVersion: 'desc' }],
    distinct: ['qbEntityId', 'qbEntityType']
  });

  let restored = 0;

  for (const snapshot of snapshots) {
    // TODO: Implement entity-specific restoration logic
    // This would map QB entities back to local database models
    // For now, just count what would be restored
    console.log(
      `Would restore ${snapshot.qbEntityType} ${snapshot.qbEntityId} v${snapshot.syncVersion}`
    );
    restored++;
  }

  console.log(`✅ Would restore ${restored} entities from snapshots`);

  return restored;
}

/**
 * Cleanup expired snapshots
 *
 * Run this as a cron job to manage storage
 */
export async function cleanupExpiredSnapshots(): Promise<number> {
  const result = await prisma.qBEntitySnapshot.deleteMany({
    where: {
      expiresAt: {
        not: null,
        lte: new Date()
      }
    }
  });

  console.log(`🧹 Cleaned up ${result.count} expired snapshots`);

  return result.count;
}

/**
 * Set expiration for old snapshots
 *
 * Keep last 5 versions per entity, expire older ones after 90 days
 */
export async function setExpirationPolicy(organizationId: string): Promise<number> {
  // Get all distinct entities
  const entities = await prisma.qBEntitySnapshot.groupBy({
    by: ['qbEntityType', 'qbEntityId'],
    where: { organizationId },
    _count: true
  });

  let updated = 0;

  for (const entity of entities) {
    // Get all snapshots for this entity, sorted by version
    const snapshots = await prisma.qBEntitySnapshot.findMany({
      where: {
        organizationId,
        qbEntityType: entity.qbEntityType,
        qbEntityId: entity.qbEntityId
      },
      orderBy: { syncVersion: 'desc' }
    });

    // Keep latest 5, expire rest after 90 days
    const toExpire = snapshots.slice(5);

    if (toExpire.length > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      await prisma.qBEntitySnapshot.updateMany({
        where: {
          id: { in: toExpire.map(s => s.id) },
          expiresAt: null
        },
        data: { expiresAt }
      });

      updated += toExpire.length;
    }
  }

  console.log(`📅 Set expiration for ${updated} old snapshots (90 days)`);

  return updated;
}
