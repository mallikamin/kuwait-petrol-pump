/**
 * QuickBooks Financial Safety Gates
 *
 * NON-NEGOTIABLE ENFORCEMENT:
 * 1. syncMode gate (READ_ONLY/WRITE_ENABLED)
 * 2. approvalRequired gate for write batches
 * 3. globalKillSwitch hard stop
 *
 * Status: BLOCKING - No QB write until all gates pass
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class QBSafetyGateError extends Error {
  constructor(
    message: string,
    public gate: string,
    public organizationId: string
  ) {
    super(message);
    this.name = 'QBSafetyGateError';
  }
}

/**
 * Gate 1: Check if kill switch is active (global emergency stop)
 *
 * @throws {QBSafetyGateError} if kill switch is active
 */
export async function checkKillSwitch(organizationId: string): Promise<void> {
  const connection = await prisma.qBConnection.findFirst({
    where: { organizationId },
    select: { globalKillSwitch: true, id: true }
  });

  if (!connection) {
    throw new QBSafetyGateError(
      'No QuickBooks connection found for this organization',
      'NO_CONNECTION',
      organizationId
    );
  }

  if (connection.globalKillSwitch) {
    throw new QBSafetyGateError(
      '🚨 QB KILL SWITCH ACTIVE - All sync operations blocked. Contact admin to disable.',
      'KILL_SWITCH_ACTIVE',
      organizationId
    );
  }
}

/**
 * Gate 2: Check if sync mode allows write operations
 *
 * @throws {QBSafetyGateError} if in READ_ONLY mode
 */
export async function checkSyncMode(organizationId: string): Promise<void> {
  const connection = await prisma.qBConnection.findFirst({
    where: { organizationId },
    select: { syncMode: true, id: true }
  });

  if (!connection) {
    throw new QBSafetyGateError(
      'No QuickBooks connection found',
      'NO_CONNECTION',
      organizationId
    );
  }

  if (connection.syncMode !== 'WRITE_ENABLED') {
    throw new QBSafetyGateError(
      `QB sync mode is ${connection.syncMode}. Write operations blocked. Admin must enable WRITE_ENABLED mode first.`,
      'READ_ONLY_MODE',
      organizationId
    );
  }
}

/**
 * Gate 3: Check if batch requires approval before execution
 *
 * @throws {QBSafetyGateError} if batch is not approved and approval is required
 */
export async function checkBatchApproval(
  batchId: string,
  organizationId: string
): Promise<void> {
  // Check if approval is required for this organization
  const connection = await prisma.qBConnection.findFirst({
    where: { organizationId },
    select: { approvalRequired: true }
  });

  if (!connection) {
    throw new QBSafetyGateError(
      'No QuickBooks connection found',
      'NO_CONNECTION',
      organizationId
    );
  }

  // If approval not required, pass gate
  if (!connection.approvalRequired) {
    return;
  }

  // Check if batch has been approved
  const unapprovedJobs = await prisma.qBSyncQueue.count({
    where: {
      batchId,
      organizationId,
      approvalStatus: { not: 'approved' }
    }
  });

  if (unapprovedJobs > 0) {
    throw new QBSafetyGateError(
      `Batch ${batchId} has ${unapprovedJobs} unapproved jobs. Admin must approve before execution.`,
      'APPROVAL_REQUIRED',
      organizationId
    );
  }
}

/**
 * Master gate check - runs all safety gates in sequence
 *
 * @param operation - 'read' | 'write'
 * @param organizationId
 * @param batchId - Required for write operations
 *
 * @throws {QBSafetyGateError} if any gate fails
 */
export async function checkAllSafetyGates(
  operation: 'read' | 'write',
  organizationId: string,
  batchId?: string
): Promise<void> {
  // Gate 1: Kill switch (always check, even for reads)
  await checkKillSwitch(organizationId);

  // Gate 2: Sync mode (only for writes)
  if (operation === 'write') {
    await checkSyncMode(organizationId);

    // Gate 3: Batch approval (only for writes)
    if (batchId) {
      await checkBatchApproval(batchId, organizationId);
    }
  }

  console.log(`✅ All safety gates passed for ${operation} operation (org: ${organizationId})`);
}

/**
 * Activate global kill switch (emergency stop)
 *
 * This immediately blocks ALL QB sync operations for the organization.
 * Use only in emergencies (data corruption, API errors, etc.)
 */
export async function activateKillSwitch(organizationId: string): Promise<void> {
  await prisma.qBConnection.updateMany({
    where: { organizationId },
    data: { globalKillSwitch: true }
  });

  // Cancel all pending jobs
  await prisma.qBSyncQueue.updateMany({
    where: {
      organizationId,
      status: { in: ['pending', 'processing'] }
    },
    data: {
      status: 'cancelled',
      errorMessage: 'Cancelled by kill switch activation'
    }
  });

  console.log(`🚨 KILL SWITCH ACTIVATED for org ${organizationId}`);
}

/**
 * Deactivate kill switch (restore normal operation)
 *
 * Use only after issue is resolved and verified.
 */
export async function deactivateKillSwitch(organizationId: string): Promise<void> {
  await prisma.qBConnection.updateMany({
    where: { organizationId },
    data: { globalKillSwitch: false }
  });

  console.log(`✅ Kill switch deactivated for org ${organizationId}`);
}

/**
 * Enable write mode (switch from READ_ONLY to WRITE_ENABLED)
 *
 * CRITICAL: Only call this after verifying:
 * - Read-only testing completed (2 weeks)
 * - All safety controls tested
 * - Backups configured
 * - User explicitly approved
 */
export async function enableWriteMode(organizationId: string): Promise<void> {
  const connection = await prisma.qBConnection.findFirst({
    where: { organizationId }
  });

  if (!connection) {
    throw new Error('No QuickBooks connection found');
  }

  if (connection.syncMode === 'WRITE_ENABLED') {
    console.log(`⚠️ Write mode already enabled for org ${organizationId}`);
    return;
  }

  await prisma.qBConnection.update({
    where: { id: connection.id },
    data: { syncMode: 'WRITE_ENABLED' }
  });

  console.log(`⚠️ WRITE MODE ENABLED for org ${organizationId}`);
}

/**
 * Disable write mode (revert to READ_ONLY)
 *
 * Use to temporarily disable writes without activating kill switch.
 */
export async function disableWriteMode(organizationId: string): Promise<void> {
  await prisma.qBConnection.updateMany({
    where: { organizationId },
    data: { syncMode: 'READ_ONLY' }
  });

  console.log(`🔒 Write mode disabled (READ_ONLY) for org ${organizationId}`);
}

/**
 * Approve a sync batch for execution
 *
 * @param batchId - Batch to approve
 * @param approvedBy - User ID who is approving
 */
export async function approveSyncBatch(
  batchId: string,
  approvedBy: string,
  organizationId: string
): Promise<number> {
  const result = await prisma.qBSyncQueue.updateMany({
    where: {
      batchId,
      organizationId,
      approvalStatus: 'pending_approval'
    },
    data: {
      approvalStatus: 'approved',
      approvedBy,
      approvedAt: new Date()
    }
  });

  console.log(`✅ Approved ${result.count} jobs in batch ${batchId}`);
  return result.count;
}

/**
 * Reject a sync batch
 *
 * @param batchId - Batch to reject
 * @param reason - Rejection reason
 */
export async function rejectSyncBatch(
  batchId: string,
  reason: string,
  organizationId: string
): Promise<number> {
  const result = await prisma.qBSyncQueue.updateMany({
    where: {
      batchId,
      organizationId,
      approvalStatus: 'pending_approval'
    },
    data: {
      approvalStatus: 'rejected',
      status: 'cancelled',
      errorMessage: `Rejected: ${reason}`
    }
  });

  console.log(`❌ Rejected ${result.count} jobs in batch ${batchId}`);
  return result.count;
}

/**
 * Get safety status for organization
 *
 * Returns current state of all safety gates
 */
export async function getSafetyStatus(organizationId: string) {
  const connection = await prisma.qBConnection.findFirst({
    where: { organizationId },
    select: {
      id: true,
      syncMode: true,
      globalKillSwitch: true,
      approvalRequired: true,
      lastSyncStatus: true,
      lastSyncAt: true
    }
  });

  if (!connection) {
    return {
      connected: false,
      canRead: false,
      canWrite: false,
      killSwitchActive: false,
      approvalRequired: false
    };
  }

  return {
    connected: true,
    canRead: !connection.globalKillSwitch,
    canWrite: !connection.globalKillSwitch && connection.syncMode === 'WRITE_ENABLED',
    killSwitchActive: connection.globalKillSwitch,
    syncMode: connection.syncMode,
    approvalRequired: connection.approvalRequired,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncAt: connection.lastSyncAt
  };
}
