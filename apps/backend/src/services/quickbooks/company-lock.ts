/**
 * QuickBooks Company Lock Service
 *
 * Rule 6: Cross-company write protection
 * - Validates realmId on EVERY write operation
 * - Prevents accidental writes to wrong QB company
 * - Hard lock mechanism for multi-tenant safety
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class CompanyLockError extends Error {
  constructor(
    message: string,
    public readonly expectedRealmId: string,
    public readonly actualRealmId: string
  ) {
    super(message);
    this.name = 'CompanyLockError';
  }
}

export class CompanyLock {
  /**
   * Validate that the connection realmId matches expected realmId
   * MUST be called before EVERY QB write operation
   */
  static async validateRealmId(
    connectionId: string,
    expectedRealmId: string
  ): Promise<void> {
    const connection = await prisma.qBConnection.findUnique({
      where: { id: connectionId },
      select: {
        realmId: true,
        companyName: true,
        isActive: true,
      },
    });

    if (!connection) {
      throw new CompanyLockError(
        `QB connection ${connectionId} not found`,
        expectedRealmId,
        'UNKNOWN'
      );
    }

    if (!connection.isActive) {
      throw new CompanyLockError(
        `QB connection ${connectionId} is inactive`,
        expectedRealmId,
        connection.realmId
      );
    }

    if (connection.realmId !== expectedRealmId) {
      throw new CompanyLockError(
        `RealmId mismatch: Expected ${expectedRealmId} (${connection.companyName}), got ${connection.realmId}. WRITE BLOCKED.`,
        expectedRealmId,
        connection.realmId
      );
    }

    // Success - realmId matches
    console.log(`[Company Lock] ✓ Validated realmId ${expectedRealmId} for ${connection.companyName}`);
  }

  /**
   * Lock a connection to a specific organization
   * Prevents cross-tenant data leakage
   */
  static async lockConnectionToOrganization(
    connectionId: string,
    organizationId: string
  ): Promise<void> {
    const connection = await prisma.qBConnection.findUnique({
      where: { id: connectionId },
      select: {
        organizationId: true,
        realmId: true,
        companyName: true,
      },
    });

    if (!connection) {
      throw new Error(`QB connection ${connectionId} not found`);
    }

    if (connection.organizationId !== organizationId) {
      throw new CompanyLockError(
        `Organization mismatch: Connection ${connectionId} belongs to org ${connection.organizationId}, not ${organizationId}`,
        organizationId,
        connection.organizationId
      );
    }

    console.log(`[Company Lock] ✓ Connection ${connectionId} locked to org ${organizationId}`);
  }

  /**
   * Get the active connection for an organization
   * Ensures single-connection-per-org (no multi-company chaos)
   */
  static async getActiveConnection(
    organizationId: string
  ): Promise<{
    id: string;
    realmId: string;
    companyName: string;
  } | null> {
    const connection = await prisma.qBConnection.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        realmId: true,
        companyName: true,
      },
      orderBy: {
        connectedAt: 'desc',
      },
    });

    return connection;
  }

  /**
   * Validate batch operation - all entities belong to same org
   */
  static async validateBatchOrganization(
    entityIds: string[],
    entityType: 'sale' | 'customer' | 'product',
    expectedOrganizationId: string
  ): Promise<void> {
    if (entityIds.length === 0) {
      return;
    }

    // Check entities based on type
    let entities: Array<{ organizationId: string } | null> = [];

    switch (entityType) {
      case 'sale':
        entities = await prisma.sale.findMany({
          where: { id: { in: entityIds } },
          select: {
            branch: {
              select: { organizationId: true },
            },
          },
        }).then(sales => sales.map(s => ({ organizationId: s.branch.organizationId })));
        break;

      case 'customer':
        entities = await prisma.customer.findMany({
          where: { id: { in: entityIds } },
          select: { organizationId: true },
        });
        break;

      case 'product':
        entities = await prisma.product.findMany({
          where: { id: { in: entityIds } },
          select: { organizationId: true },
        });
        break;
    }

    // Validate all belong to expected org
    const invalidEntities = entities.filter(
      e => e && e.organizationId !== expectedOrganizationId
    );

    if (invalidEntities.length > 0) {
      throw new CompanyLockError(
        `Batch validation failed: ${invalidEntities.length} entities do not belong to organization ${expectedOrganizationId}`,
        expectedOrganizationId,
        'MIXED'
      );
    }

    console.log(
      `[Company Lock] ✓ Validated batch of ${entityIds.length} ${entityType}s belong to org ${expectedOrganizationId}`
    );
  }

  /**
   * Emergency: Disable all write operations for a specific connection
   */
  static async emergencyLockConnection(
    connectionId: string,
    reason: string
  ): Promise<void> {
    await prisma.qBConnection.update({
      where: { id: connectionId },
      data: {
        globalKillSwitch: true,
        syncMode: 'READ_ONLY',
        lastSyncStatus: 'failed',
      },
    });

    console.error(
      `[Company Lock] 🚨 EMERGENCY LOCK: Connection ${connectionId} disabled. Reason: ${reason}`
    );
  }

  /**
   * Get company lock status
   */
  static async getLockStatus(
    connectionId: string
  ): Promise<{
    isLocked: boolean;
    realmId: string;
    companyName: string;
    organizationId: string;
    syncMode: string;
    killSwitch: boolean;
  }> {
    const connection = await prisma.qBConnection.findUnique({
      where: { id: connectionId },
      select: {
        realmId: true,
        companyName: true,
        organizationId: true,
        syncMode: true,
        globalKillSwitch: true,
        isActive: true,
      },
    });

    if (!connection) {
      throw new Error(`QB connection ${connectionId} not found`);
    }

    return {
      isLocked: !connection.isActive || connection.globalKillSwitch,
      realmId: connection.realmId,
      companyName: connection.companyName,
      organizationId: connection.organizationId,
      syncMode: connection.syncMode,
      killSwitch: connection.globalKillSwitch,
    };
  }
}
