/**
 * QuickBooks Entity Mapping Service
 *
 * Maps local entity IDs to QuickBooks entity IDs
 * - Replaces hardcoded QB references with dynamic mappings
 * - Enforces org isolation on all operations
 * - Supports customer, payment_method, and item entity types
 */

import { prisma } from '../../config/database';

export type EntityType = 'customer' | 'payment_method' | 'item' | 'vendor' | 'expense_account' | 'bank_account' | 'bank' | 'account';

export interface MappingFilter {
  entityType?: EntityType;
  localId?: string;
  qbId?: string;
  isActive?: boolean;
}

export interface BulkUpsertRow {
  entityType: EntityType;
  localId: string;
  qbId: string;
  qbName?: string;
}

export interface BulkUpsertResult {
  success: boolean;
  entityType: EntityType;
  localId: string;
  qbId?: string;
  error?: string;
}

export class EntityMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityMappingError';
  }
}

export class EntityMappingService {
  /**
   * Upsert a mapping (create or update)
   * @param organizationId - Organization ID (enforces isolation)
   * @param entityType - Entity type (customer, payment_method, item)
   * @param localId - Local entity ID (from Kuwait POS)
   * @param qbId - QuickBooks entity ID
   * @param qbName - QuickBooks entity name (optional)
   * @returns Created or updated mapping
   */
  static async upsertMapping(
    organizationId: string,
    entityType: EntityType,
    localId: string,
    qbId: string,
    qbName?: string
  ): Promise<{ id: string; qbId: string; qbName: string | null }> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }
    if (!entityType || !entityType.trim()) {
      throw new EntityMappingError('Missing required field: entityType');
    }
    if (!localId || !localId.trim()) {
      throw new EntityMappingError('Missing required field: localId');
    }
    if (!qbId || !qbId.trim()) {
      throw new EntityMappingError('Missing required field: qbId');
    }

    // Normalize entityType (lowercase, trim)
    const normalizedEntityType = entityType.toLowerCase().trim() as EntityType;

    // Validate entityType enum
    const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'vendor', 'expense_account', 'bank_account', 'bank', 'account'];
    if (!validTypes.includes(normalizedEntityType)) {
      throw new EntityMappingError(
        `Invalid entityType: ${entityType}. Must be one of: ${validTypes.join(', ')}`
      );
    }

    // Trim IDs
    const trimmedLocalId = localId.trim();
    const trimmedQbId = qbId.trim();
    const trimmedQbName = qbName?.trim() || null;

    // Upsert mapping (on conflict update)
    const mapping = await prisma.qBEntityMapping.upsert({
      where: {
        uq_qb_mapping_org_type_local: {
          organizationId,
          entityType: normalizedEntityType,
          localId: trimmedLocalId
        }
      },
      create: {
        organizationId,
        entityType: normalizedEntityType,
        localId: trimmedLocalId,
        qbId: trimmedQbId,
        qbName: trimmedQbName,
        isActive: true
      },
      update: {
        qbId: trimmedQbId,
        qbName: trimmedQbName,
        isActive: true,
        updatedAt: new Date()
      },
      select: {
        id: true,
        qbId: true,
        qbName: true
      }
    });

    console.log(
      `[Entity Mapping] ✓ Upserted mapping: org=${organizationId}, type=${normalizedEntityType}, local=${trimmedLocalId}, qb=${trimmedQbId}`
    );

    return mapping;
  }

  /**
   * Get QuickBooks ID for a local entity
   * @param organizationId - Organization ID (enforces isolation)
   * @param entityType - Entity type
   * @param localId - Local entity ID
   * @returns QuickBooks entity ID or null if not found
   */
  static async getQbId(
    organizationId: string,
    entityType: EntityType,
    localId: string
  ): Promise<string | null> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }
    if (!entityType || !entityType.trim()) {
      throw new EntityMappingError('Missing required field: entityType');
    }
    if (!localId || !localId.trim()) {
      throw new EntityMappingError('Missing required field: localId');
    }

    // Normalize and validate entityType
    const normalizedEntityType = entityType.toLowerCase().trim() as EntityType;
    const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'bank', 'account'];
    if (!validTypes.includes(normalizedEntityType)) {
      throw new EntityMappingError(
        `Invalid entityType: ${entityType}. Must be one of: ${validTypes.join(', ')}`
      );
    }

    // Trim localId
    const trimmedLocalId = localId.trim();

    // Query mapping
    const mapping = await prisma.qBEntityMapping.findUnique({
      where: {
        uq_qb_mapping_org_type_local: {
          organizationId,
          entityType: normalizedEntityType,
          localId: trimmedLocalId
        }
      },
      select: {
        qbId: true,
        isActive: true
      }
    });

    // Return null if not found or inactive
    if (!mapping || !mapping.isActive) {
      return null;
    }

    return mapping.qbId;
  }

  /**
   * Get local entity ID for a QuickBooks entity (reverse lookup)
   * @param organizationId - Organization ID (enforces isolation)
   * @param entityType - Entity type
   * @param qbId - QuickBooks entity ID
   * @returns Local entity ID or null if not found
   */
  static async getLocalId(
    organizationId: string,
    entityType: EntityType,
    qbId: string
  ): Promise<string | null> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }
    if (!entityType || !entityType.trim()) {
      throw new EntityMappingError('Missing required field: entityType');
    }
    if (!qbId || !qbId.trim()) {
      throw new EntityMappingError('Missing required field: qbId');
    }

    // Normalize and validate entityType
    const normalizedEntityType = entityType.toLowerCase().trim() as EntityType;
    const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'bank', 'account'];
    if (!validTypes.includes(normalizedEntityType)) {
      throw new EntityMappingError(
        `Invalid entityType: ${entityType}. Must be one of: ${validTypes.join(', ')}`
      );
    }

    // Trim qbId
    const trimmedQbId = qbId.trim();

    // Query mapping (reverse lookup)
    const mapping = await prisma.qBEntityMapping.findUnique({
      where: {
        uq_qb_mapping_org_type_qb: {
          organizationId,
          entityType: normalizedEntityType,
          qbId: trimmedQbId
        }
      },
      select: {
        localId: true,
        isActive: true
      }
    });

    // Return null if not found or inactive
    if (!mapping || !mapping.isActive) {
      return null;
    }

    return mapping.localId;
  }

  /**
   * List mappings with optional filters
   * @param organizationId - Organization ID (enforces isolation)
   * @param filters - Optional filters (entityType, localId, qbId, isActive)
   * @returns Array of mappings
   */
  static async listMappings(
    organizationId: string,
    filters?: MappingFilter
  ): Promise<Array<{
    id: string;
    entityType: string;
    localId: string;
    qbId: string;
    qbName: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }

    // Build where clause (org isolation + optional filters)
    const where: any = { organizationId };

    if (filters?.entityType) {
      // Normalize and validate entityType
      const normalizedEntityType = filters.entityType.toLowerCase().trim() as EntityType;
      const validTypes: EntityType[] = ['customer', 'payment_method', 'item'];
      if (!validTypes.includes(normalizedEntityType)) {
        throw new EntityMappingError(
          `Invalid entityType filter: ${filters.entityType}. Must be one of: ${validTypes.join(', ')}`
        );
      }
      where.entityType = normalizedEntityType;
    }

    if (filters?.localId) {
      where.localId = filters.localId.trim();
    }

    if (filters?.qbId) {
      where.qbId = filters.qbId.trim();
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    // Query mappings
    const mappings = await prisma.qBEntityMapping.findMany({
      where,
      select: {
        id: true,
        entityType: true,
        localId: true,
        qbId: true,
        qbName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { entityType: 'asc' },
        { localId: 'asc' }
      ]
    });

    return mappings;
  }

  /**
   * Deactivate a mapping (soft delete, does not remove data)
   * @param organizationId - Organization ID (enforces isolation)
   * @param mappingId - Mapping ID to deactivate
   * @returns Updated mapping
   */
  static async deactivateMapping(
    organizationId: string,
    mappingId: string
  ): Promise<{ id: string; isActive: boolean }> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }
    if (!mappingId || !mappingId.trim()) {
      throw new EntityMappingError('Missing required field: mappingId');
    }

    // Verify mapping belongs to organization
    const mapping = await prisma.qBEntityMapping.findUnique({
      where: { id: mappingId },
      select: { organizationId: true }
    });

    if (!mapping) {
      throw new EntityMappingError('Mapping not found');
    }

    if (mapping.organizationId !== organizationId) {
      throw new EntityMappingError('Unauthorized: mapping does not belong to this organization');
    }

    // Deactivate mapping
    const updated = await prisma.qBEntityMapping.update({
      where: { id: mappingId },
      data: { isActive: false, updatedAt: new Date() },
      select: { id: true, isActive: true }
    });

    console.log(`[Entity Mapping] ✓ Deactivated mapping: id=${mappingId}`);

    return updated;
  }

  /**
   * Bulk upsert mappings (best-effort per-row upsert with partial-failure handling)
   *
   * NOTE: This is NOT a true database transaction. Each row is processed sequentially
   * with individual try/catch blocks. Successfully processed rows are committed even if
   * later rows fail. This provides partial-failure resilience for bulk imports.
   *
   * @param organizationId - Organization ID (enforces isolation)
   * @param rows - Array of mapping rows to upsert
   * @returns Array of results with per-row success/failure status
   */
  static async bulkUpsert(
    organizationId: string,
    rows: BulkUpsertRow[]
  ): Promise<BulkUpsertResult[]> {
    // Validation
    if (!organizationId || !organizationId.trim()) {
      throw new EntityMappingError('Missing required field: organizationId');
    }

    if (!rows || rows.length === 0) {
      throw new EntityMappingError('Missing required field: rows (must have at least 1 row)');
    }

    // Process each row individually (partial-failure safe)
    const results: BulkUpsertResult[] = [];

    for (const row of rows) {
      try {
        // Upsert mapping
        const mapping = await this.upsertMapping(
          organizationId,
          row.entityType,
          row.localId,
          row.qbId,
          row.qbName
        );

        results.push({
          success: true,
          entityType: row.entityType,
          localId: row.localId,
          qbId: mapping.qbId
        });
      } catch (error) {
        // Capture error for this row, continue processing others
        results.push({
          success: false,
          entityType: row.entityType,
          localId: row.localId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(
      `[Entity Mapping] Bulk upsert complete: ${results.filter(r => r.success).length}/${rows.length} succeeded`
    );

    return results;
  }
}
