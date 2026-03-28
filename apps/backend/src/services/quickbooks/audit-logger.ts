/**
 * QuickBooks Audit Logger Service
 *
 * Rule 3: Immutable append-only log for every QB operation
 * - Logs ALL QB API calls, decisions, state changes
 * - Supports forensic reconstruction
 * - Structured for easy querying
 * - NEVER modifies or deletes entries
 */

import { PrismaClient } from '@prisma/client';
import { redactSensitiveData } from './encryption';

const prisma = new PrismaClient();

export interface AuditLogEntry {
  operation: string;
  entity_type: string;
  entity_id?: string;
  direction: 'APP_TO_QB' | 'QB_TO_APP';
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  request_payload?: any;
  response_payload?: any;
  error_message?: string;
  metadata?: Record<string, any>;
}

export class AuditLogger {
  /**
   * Log a QB operation (append-only)
   */
  static async log(entry: AuditLogEntry): Promise<void> {
    try {
      // Redact sensitive fields
      const safeRequest = entry.request_payload
        ? redactSensitiveData(entry.request_payload)
        : null;

      const safeResponse = entry.response_payload
        ? redactSensitiveData(entry.response_payload)
        : null;

      await prisma.quickBooksAuditLog.create({
        data: {
          operation: entry.operation,
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          direction: entry.direction,
          status: entry.status,
          request_payload: safeRequest,
          response_payload: safeResponse,
          error_message: entry.error_message,
          metadata: entry.metadata,
        },
      });

      console.log(`[QB Audit] ${entry.operation} ${entry.status}`, {
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        direction: entry.direction,
      });
    } catch (error) {
      // CRITICAL: If audit logging fails, DO NOT proceed with operation
      console.error('[QB Audit] FAILED TO LOG - ABORTING OPERATION', error);
      throw new Error('Audit logging failed - operation aborted for safety');
    }
  }

  /**
   * Log QB sync start
   */
  static async logSyncStart(
    entity_type: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    await this.log({
      operation: 'SYNC_START',
      entity_type,
      direction: 'APP_TO_QB',
      status: 'PENDING',
      metadata,
    });

    return `sync_${entity_type}_${Date.now()}`;
  }

  /**
   * Log QB sync completion
   */
  static async logSyncComplete(
    entity_type: string,
    sync_id: string,
    stats: {
      created: number;
      updated: number;
      failed: number;
    }
  ): Promise<void> {
    await this.log({
      operation: 'SYNC_COMPLETE',
      entity_type,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        sync_id,
        ...stats,
      },
    });
  }

  /**
   * Log QB sync failure
   */
  static async logSyncFailure(
    entity_type: string,
    sync_id: string,
    error: Error
  ): Promise<void> {
    await this.log({
      operation: 'SYNC_FAILURE',
      entity_type,
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      error_message: error.message,
      metadata: {
        sync_id,
        stack: error.stack,
      },
    });
  }

  /**
   * Log entity creation in QB
   */
  static async logEntityCreate(
    entity_type: string,
    entity_id: string,
    request: any,
    response?: any,
    error?: Error
  ): Promise<void> {
    await this.log({
      operation: 'CREATE',
      entity_type,
      entity_id,
      direction: 'APP_TO_QB',
      status: error ? 'FAILURE' : 'SUCCESS',
      request_payload: request,
      response_payload: response,
      error_message: error?.message,
    });
  }

  /**
   * Log entity update in QB
   */
  static async logEntityUpdate(
    entity_type: string,
    entity_id: string,
    request: any,
    response?: any,
    error?: Error
  ): Promise<void> {
    await this.log({
      operation: 'UPDATE',
      entity_type,
      entity_id,
      direction: 'APP_TO_QB',
      status: error ? 'FAILURE' : 'SUCCESS',
      request_payload: request,
      response_payload: response,
      error_message: error?.message,
    });
  }

  /**
   * Log entity read from QB
   */
  static async logEntityRead(
    entity_type: string,
    entity_id: string,
    response: any
  ): Promise<void> {
    await this.log({
      operation: 'READ',
      entity_type,
      entity_id,
      direction: 'QB_TO_APP',
      status: 'SUCCESS',
      response_payload: response,
    });
  }

  /**
   * Log batch operation
   */
  static async logBatchOperation(
    entity_type: string,
    operation: string,
    entity_ids: string[],
    results: {
      success: number;
      failed: number;
      errors: Array<{ entity_id: string; error: string }>;
    }
  ): Promise<void> {
    await this.log({
      operation: 'BATCH_' + operation.toUpperCase(),
      entity_type,
      direction: 'APP_TO_QB',
      status: results.failed > 0 ? 'FAILURE' : 'SUCCESS',
      metadata: {
        entity_ids,
        total: entity_ids.length,
        success: results.success,
        failed: results.failed,
        errors: results.errors,
      },
    });
  }

  /**
   * Query audit log for entity history
   */
  static async getEntityHistory(
    entity_type: string,
    entity_id: string,
    limit = 50
  ): Promise<any[]> {
    return prisma.quickBooksAuditLog.findMany({
      where: {
        entity_type,
        entity_id,
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Query audit log for sync history
   */
  static async getSyncHistory(
    entity_type?: string,
    limit = 100
  ): Promise<any[]> {
    return prisma.quickBooksAuditLog.findMany({
      where: {
        operation: {
          in: ['SYNC_START', 'SYNC_COMPLETE', 'SYNC_FAILURE'],
        },
        ...(entity_type && { entity_type }),
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Query audit log for recent failures
   */
  static async getRecentFailures(
    hours = 24,
    entity_type?: string
  ): Promise<any[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return prisma.quickBooksAuditLog.findMany({
      where: {
        status: 'FAILURE',
        created_at: {
          gte: since,
        },
        ...(entity_type && { entity_type }),
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  /**
   * Get audit statistics
   */
  static async getStats(
    entity_type?: string,
    hours = 24
  ): Promise<{
    total: number;
    success: number;
    failure: number;
    pending: number;
    by_operation: Record<string, number>;
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const logs = await prisma.quickBooksAuditLog.findMany({
      where: {
        created_at: {
          gte: since,
        },
        ...(entity_type && { entity_type }),
      },
      select: {
        status: true,
        operation: true,
      },
    });

    const stats = {
      total: logs.length,
      success: logs.filter(l => l.status === 'SUCCESS').length,
      failure: logs.filter(l => l.status === 'FAILURE').length,
      pending: logs.filter(l => l.status === 'PENDING').length,
      by_operation: {} as Record<string, number>,
    };

    logs.forEach(log => {
      stats.by_operation[log.operation] = (stats.by_operation[log.operation] || 0) + 1;
    });

    return stats;
  }
}
