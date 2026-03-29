/**
 * Tests for EntityMappingService
 *
 * Tests:
 * - Upsert mapping (create and update)
 * - Get QB ID (forward lookup)
 * - Get local ID (reverse lookup)
 * - List mappings with filters
 * - Bulk upsert (partial failure safe)
 * - Organization isolation
 * - Validation errors
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { EntityMappingService, EntityMappingError } from './entity-mapping.service';

// Mock database
jest.mock('../../config/database', () => ({
  prisma: {
    qBEntityMapping: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn()
    }
  }
}));

// Import mocked prisma
import { prisma } from '../../config/database';

describe('EntityMappingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upsertMapping', () => {
    it('should create new mapping successfully', async () => {
      const mockMapping = {
        id: 'mapping-123',
        qbId: 'QB-456',
        qbName: 'Test Customer'
      };

      (prisma.qBEntityMapping.upsert as jest.MockedFunction<any>).mockResolvedValue(mockMapping);

      const result = await EntityMappingService.upsertMapping(
        'org-123',
        'customer',
        'local-456',
        'QB-456',
        'Test Customer'
      );

      expect(result).toEqual(mockMapping);
      expect(prisma.qBEntityMapping.upsert).toHaveBeenCalledWith({
        where: {
          uq_qb_mapping_org_type_local: {
            organizationId: 'org-123',
            entityType: 'customer',
            localId: 'local-456'
          }
        },
        create: expect.objectContaining({
          organizationId: 'org-123',
          entityType: 'customer',
          localId: 'local-456',
          qbId: 'QB-456',
          qbName: 'Test Customer',
          isActive: true
        }),
        update: expect.objectContaining({
          qbId: 'QB-456',
          qbName: 'Test Customer',
          isActive: true
        }),
        select: {
          id: true,
          qbId: true,
          qbName: true
        }
      });
    });

    it('should update existing mapping', async () => {
      const mockMapping = {
        id: 'mapping-123',
        qbId: 'QB-789',
        qbName: 'Updated Customer'
      };

      (prisma.qBEntityMapping.upsert as jest.MockedFunction<any>).mockResolvedValue(mockMapping);

      const result = await EntityMappingService.upsertMapping(
        'org-123',
        'customer',
        'local-456',
        'QB-789',
        'Updated Customer'
      );

      expect(result.qbId).toBe('QB-789');
      expect(result.qbName).toBe('Updated Customer');
    });

    it('should normalize and trim entity type', async () => {
      const mockMapping = {
        id: 'mapping-123',
        qbId: 'QB-456',
        qbName: null
      };

      (prisma.qBEntityMapping.upsert as jest.MockedFunction<any>).mockResolvedValue(mockMapping);

      await EntityMappingService.upsertMapping(
        'org-123',
        '  CUSTOMER  ' as any,
        'local-456',
        'QB-456'
      );

      expect(prisma.qBEntityMapping.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            uq_qb_mapping_org_type_local: expect.objectContaining({
              entityType: 'customer'
            })
          })
        })
      );
    });

    it('should throw error for missing organizationId', async () => {
      await expect(
        EntityMappingService.upsertMapping('', 'customer', 'local-456', 'QB-456')
      ).rejects.toThrow('Missing required field: organizationId');
    });

    it('should throw error for missing entityType', async () => {
      await expect(
        EntityMappingService.upsertMapping('org-123', '' as any, 'local-456', 'QB-456')
      ).rejects.toThrow('Missing required field: entityType');
    });

    it('should throw error for missing localId', async () => {
      await expect(
        EntityMappingService.upsertMapping('org-123', 'customer', '', 'QB-456')
      ).rejects.toThrow('Missing required field: localId');
    });

    it('should throw error for missing qbId', async () => {
      await expect(
        EntityMappingService.upsertMapping('org-123', 'customer', 'local-456', '')
      ).rejects.toThrow('Missing required field: qbId');
    });

    it('should throw error for invalid entityType', async () => {
      await expect(
        EntityMappingService.upsertMapping('org-123', 'invalid' as any, 'local-456', 'QB-456')
      ).rejects.toThrow(/Invalid entityType.*Must be one of: customer, payment_method, item/);
    });
  });

  describe('getQbId', () => {
    it('should return QB ID for active mapping', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue({
        qbId: 'QB-456',
        isActive: true
      });

      const result = await EntityMappingService.getQbId('org-123', 'customer', 'local-456');

      expect(result).toBe('QB-456');
      expect(prisma.qBEntityMapping.findUnique).toHaveBeenCalledWith({
        where: {
          uq_qb_mapping_org_type_local: {
            organizationId: 'org-123',
            entityType: 'customer',
            localId: 'local-456'
          }
        },
        select: {
          qbId: true,
          isActive: true
        }
      });
    });

    it('should return null if mapping not found', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue(null);

      const result = await EntityMappingService.getQbId('org-123', 'customer', 'local-456');

      expect(result).toBeNull();
    });

    it('should return null if mapping is inactive', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue({
        qbId: 'QB-456',
        isActive: false
      });

      const result = await EntityMappingService.getQbId('org-123', 'customer', 'local-456');

      expect(result).toBeNull();
    });

    it('should enforce organization isolation', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue({
        qbId: 'QB-456',
        isActive: true
      });

      await EntityMappingService.getQbId('org-999', 'customer', 'local-456');

      expect(prisma.qBEntityMapping.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            uq_qb_mapping_org_type_local: {
              organizationId: 'org-999',
              entityType: 'customer',
              localId: 'local-456'
            }
          }
        })
      );
    });
  });

  describe('getLocalId', () => {
    it('should return local ID for active mapping (reverse lookup)', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue({
        localId: 'local-456',
        isActive: true
      });

      const result = await EntityMappingService.getLocalId('org-123', 'customer', 'QB-456');

      expect(result).toBe('local-456');
      expect(prisma.qBEntityMapping.findUnique).toHaveBeenCalledWith({
        where: {
          uq_qb_mapping_org_type_qb: {
            organizationId: 'org-123',
            entityType: 'customer',
            qbId: 'QB-456'
          }
        },
        select: {
          localId: true,
          isActive: true
        }
      });
    });

    it('should return null if reverse mapping not found', async () => {
      (prisma.qBEntityMapping.findUnique as jest.MockedFunction<any>).mockResolvedValue(null);

      const result = await EntityMappingService.getLocalId('org-123', 'customer', 'QB-456');

      expect(result).toBeNull();
    });
  });

  describe('listMappings', () => {
    it('should list all mappings for organization', async () => {
      const mockMappings = [
        {
          id: 'mapping-1',
          entityType: 'customer',
          localId: 'local-1',
          qbId: 'QB-1',
          qbName: 'Customer 1',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'mapping-2',
          entityType: 'item',
          localId: 'local-2',
          qbId: 'QB-2',
          qbName: 'Item 1',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (prisma.qBEntityMapping.findMany as jest.MockedFunction<any>).mockResolvedValue(mockMappings);

      const result = await EntityMappingService.listMappings('org-123');

      expect(result).toEqual(mockMappings);
      expect(prisma.qBEntityMapping.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-123' },
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
    });

    it('should filter by entityType', async () => {
      (prisma.qBEntityMapping.findMany as jest.MockedFunction<any>).mockResolvedValue([]);

      await EntityMappingService.listMappings('org-123', { entityType: 'customer' });

      expect(prisma.qBEntityMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-123',
            entityType: 'customer'
          })
        })
      );
    });

    it('should filter by isActive', async () => {
      (prisma.qBEntityMapping.findMany as jest.MockedFunction<any>).mockResolvedValue([]);

      await EntityMappingService.listMappings('org-123', { isActive: true });

      expect(prisma.qBEntityMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-123',
            isActive: true
          })
        })
      );
    });
  });

  describe('bulkUpsert', () => {
    it('should upsert multiple mappings successfully', async () => {
      const mockMapping1 = { id: 'mapping-1', qbId: 'QB-1', qbName: null };
      const mockMapping2 = { id: 'mapping-2', qbId: 'QB-2', qbName: null };

      (prisma.qBEntityMapping.upsert as jest.MockedFunction<any>)
        .mockResolvedValueOnce(mockMapping1)
        .mockResolvedValueOnce(mockMapping2);

      const rows = [
        { entityType: 'customer' as const, localId: 'local-1', qbId: 'QB-1' },
        { entityType: 'item' as const, localId: 'local-2', qbId: 'QB-2' }
      ];

      const results = await EntityMappingService.bulkUpsert('org-123', rows);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        success: true,
        entityType: 'customer',
        localId: 'local-1',
        qbId: 'QB-1'
      });
      expect(results[1]).toEqual({
        success: true,
        entityType: 'item',
        localId: 'local-2',
        qbId: 'QB-2'
      });
    });

    it('should handle partial failures gracefully', async () => {
      const mockMapping1 = { id: 'mapping-1', qbId: 'QB-1', qbName: null };

      (prisma.qBEntityMapping.upsert as jest.MockedFunction<any>)
        .mockResolvedValueOnce(mockMapping1)
        .mockRejectedValueOnce(new Error('Duplicate QB ID'));

      const rows = [
        { entityType: 'customer' as const, localId: 'local-1', qbId: 'QB-1' },
        { entityType: 'customer' as const, localId: 'local-2', qbId: 'QB-1' } // Duplicate QB ID
      ];

      const results = await EntityMappingService.bulkUpsert('org-123', rows);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Duplicate QB ID');
    });

    it('should throw error for empty rows array', async () => {
      await expect(
        EntityMappingService.bulkUpsert('org-123', [])
      ).rejects.toThrow('Missing required field: rows');
    });
  });
});
