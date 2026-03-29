/**
 * QuickBooks Mapping API Routes Integration Tests
 * Tests real Express routes from routes.ts (not inline duplicates)
 * Uses supertest to hit actual registered endpoints
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { EntityMappingService } from './entity-mapping.service';
import { AuditLogger } from './audit-logger';

// Mock dependencies BEFORE importing router
jest.mock('./entity-mapping.service');
jest.mock('./audit-logger');
jest.mock('./oauth-state', () => ({
  generateState: jest.fn(() => 'mock-state'),
  validateState: jest.fn(() => true),
}));
jest.mock('./encryption', () => ({
  encryptToken: jest.fn((token: string) => `encrypted-${token}`),
  decryptToken: jest.fn((token: string) => token.replace('encrypted-', '')),
}));
jest.mock('./preflight.service', () => ({
  runPreflightChecks: jest.fn(),
}));
jest.mock('./safety-gates', () => ({
  getSafetyStatus: jest.fn(),
  setSyncMode: jest.fn(),
  activateKillSwitch: jest.fn(),
  deactivateKillSwitch: jest.fn(),
  enableWriteMode: jest.fn(),
  disableWriteMode: jest.fn(),
}));

// Mock Prisma Client
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    qBConnection: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    qBSyncJob: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $disconnect: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

// Mock intuit-oauth
jest.mock('intuit-oauth', () => {
  return jest.fn().mockImplementation(() => ({
    authorizeUri: jest.fn(() => 'https://mock-oauth-url.com'),
    createToken: jest.fn(),
    getToken: jest.fn(),
    refreshAccessToken: jest.fn(),
  }));
});

// Mock authentication middleware BEFORE importing router
// This allows us to control authentication scenarios in tests
let mockAuthScenario: 'none' | 'admin' | 'manager' | 'cashier' = 'admin';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (mockAuthScenario === 'none') {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Simulate authenticated user
    req.user = {
      userId: 'test-user-id',
      organizationId: 'test-org-id',
      role: mockAuthScenario,
    };
    next();
  },
  authorize: (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    };
  },
}));

// NOW import the router (after mocks are set up)
import quickbooksRouter from './routes';

describe('QuickBooks Mapping API Routes (Real Router Integration)', () => {
  let app: Express;

  /**
   * Create test Express app with real quickbooks router mounted
   */
  function createTestApp(): Express {
    const testApp = express();
    testApp.use(express.json());

    // Mount real QuickBooks router
    testApp.use('/api/quickbooks', quickbooksRouter);

    // Error handler
    testApp.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    return testApp;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthScenario = 'admin'; // Default to admin for most tests
    app = createTestApp();
  });

  describe('GET /api/quickbooks/mappings', () => {
    it('should return mappings for authenticated user (happy path)', async () => {
      const mockMappings = [
        {
          id: 'map-1',
          organizationId: 'test-org-id',
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
          qbName: 'Walk-in Customer',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue(mockMappings);

      const response = await request(app).get('/api/quickbooks/mappings');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        count: 1,
        mappings: expect.arrayContaining([
          expect.objectContaining({
            id: 'map-1',
            entityType: 'customer',
            localId: 'walk-in',
            qbId: 'QB-123',
          }),
        ]),
      });
      expect(EntityMappingService.listMappings).toHaveBeenCalledWith('test-org-id', {});
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthScenario = 'none';
      app = createTestApp();

      const response = await request(app).get('/api/quickbooks/mappings');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Not authenticated' });
      expect(EntityMappingService.listMappings).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid entityType', async () => {
      const response = await request(app)
        .get('/api/quickbooks/mappings')
        .query({ entityType: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid entityType: invalid_type. Must be one of: customer, payment_method, item',
      });
      expect(EntityMappingService.listMappings).not.toHaveBeenCalled();
    });

    it('should filter by entityType when provided', async () => {
      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/quickbooks/mappings')
        .query({ entityType: 'customer' });

      expect(response.status).toBe(200);
      expect(EntityMappingService.listMappings).toHaveBeenCalledWith('test-org-id', {
        entityType: 'customer',
      });
    });

    it('should filter by multiple criteria', async () => {
      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/quickbooks/mappings')
        .query({
          entityType: 'item',
          localId: 'fuel-1',
          isActive: 'true',
        });

      expect(response.status).toBe(200);
      expect(EntityMappingService.listMappings).toHaveBeenCalledWith('test-org-id', {
        entityType: 'item',
        localId: 'fuel-1',
        isActive: true,
      });
    });

    it('should enforce org isolation (use req.user.organizationId, ignore query param)', async () => {
      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/quickbooks/mappings')
        .query({ organizationId: 'attacker-org-id' }); // Attempt to query different org

      expect(response.status).toBe(200);
      // Should use org from authenticated user, NOT from query
      expect(EntityMappingService.listMappings).toHaveBeenCalledWith('test-org-id', {});
    });

    it('should work for all authenticated roles (no role restriction on GET)', async () => {
      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue([]);

      mockAuthScenario = 'cashier';
      app = createTestApp();

      const response = await request(app).get('/api/quickbooks/mappings');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/quickbooks/mappings', () => {
    it('should upsert mapping for admin user (happy path)', async () => {
      const mockMapping = {
        id: 'map-1',
        organizationId: 'test-org-id',
        entityType: 'customer',
        localId: 'walk-in',
        qbId: 'QB-123',
        qbName: 'Walk-in Customer',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (EntityMappingService.upsertMapping as jest.Mock).mockResolvedValue(mockMapping);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
          qbName: 'Walk-in Customer',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        mapping: expect.objectContaining({
          id: 'map-1',
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
        }),
      });
      expect(EntityMappingService.upsertMapping).toHaveBeenCalledWith(
        'test-org-id',
        'customer',
        'walk-in',
        'QB-123',
        'Walk-in Customer'
      );
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'UPSERT_ENTITY_MAPPING',
          entity_type: 'customer',
          status: 'SUCCESS',
        })
      );
    });

    it('should upsert mapping for manager user', async () => {
      const mockMapping = {
        id: 'map-1',
        organizationId: 'test-org-id',
        entityType: 'item',
        localId: 'fuel-1',
        qbId: 'QB-456',
        qbName: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (EntityMappingService.upsertMapping as jest.Mock).mockResolvedValue(mockMapping);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      mockAuthScenario = 'manager';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'item',
          localId: 'fuel-1',
          qbId: 'QB-456',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthScenario = 'none';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Not authenticated' });
      expect(EntityMappingService.upsertMapping).not.toHaveBeenCalled();
    });

    it('should return 403 for non-admin/manager roles (cashier forbidden)', async () => {
      mockAuthScenario = 'cashier';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Insufficient permissions' });
      expect(EntityMappingService.upsertMapping).not.toHaveBeenCalled();
    });

    it('should return 400 when required fields missing', async () => {
      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'customer',
          localId: 'walk-in',
          // Missing qbId
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing required fields: entityType, localId, qbId',
      });
      expect(EntityMappingService.upsertMapping).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid entityType', async () => {
      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'invalid',
          localId: 'test',
          qbId: 'QB-123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid entityType: invalid. Must be one of: customer, payment_method, item',
      });
      expect(EntityMappingService.upsertMapping).not.toHaveBeenCalled();
    });

    it('should enforce org isolation (ignore body organizationId)', async () => {
      const mockMapping = {
        id: 'map-1',
        organizationId: 'test-org-id',
        entityType: 'customer',
        localId: 'walk-in',
        qbId: 'QB-123',
        qbName: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (EntityMappingService.upsertMapping as jest.Mock).mockResolvedValue(mockMapping);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          organizationId: 'attacker-org-id', // Attempt to write to different org
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
        });

      expect(response.status).toBe(200);
      // Should use org from authenticated user, NOT from body
      expect(EntityMappingService.upsertMapping).toHaveBeenCalledWith(
        'test-org-id',
        'customer',
        'walk-in',
        'QB-123',
        undefined
      );
    });
  });

  describe('POST /api/quickbooks/mappings/bulk', () => {
    it('should bulk upsert mappings for admin user (happy path)', async () => {
      const mockResults = [
        { success: true, entityType: 'customer' as const, localId: 'walk-in', qbId: 'QB-123' },
        { success: true, entityType: 'item' as const, localId: 'fuel-1', qbId: 'QB-456' },
      ];

      (EntityMappingService.bulkUpsert as jest.Mock).mockResolvedValue(mockResults);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [
            { entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' },
            { entityType: 'item', localId: 'fuel-1', qbId: 'QB-456' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        totalRows: 2,
        successCount: 2,
        failureCount: 0,
        results: mockResults,
      });
      expect(EntityMappingService.bulkUpsert).toHaveBeenCalledWith('test-org-id', [
        { entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' },
        { entityType: 'item', localId: 'fuel-1', qbId: 'QB-456' },
      ]);
      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'BULK_UPSERT_ENTITY_MAPPINGS',
          status: 'SUCCESS',
          metadata: expect.objectContaining({
            totalRows: 2,
            successCount: 2,
            failureCount: 0,
          }),
        })
      );
    });

    it('should handle partial success results correctly', async () => {
      const mockResults = [
        { success: true, entityType: 'customer' as const, localId: 'walk-in', qbId: 'QB-123' },
        { success: false, entityType: 'item' as const, localId: 'fuel-1', error: 'QB API error' },
      ];

      (EntityMappingService.bulkUpsert as jest.Mock).mockResolvedValue(mockResults);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [
            { entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' },
            { entityType: 'item', localId: 'fuel-1', qbId: 'QB-456' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        totalRows: 2,
        successCount: 1,
        failureCount: 1,
        results: mockResults,
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthScenario = 'none';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [{ entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' }],
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Not authenticated' });
      expect(EntityMappingService.bulkUpsert).not.toHaveBeenCalled();
    });

    it('should return 403 for non-admin/manager roles', async () => {
      mockAuthScenario = 'cashier';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [{ entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' }],
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Insufficient permissions' });
      expect(EntityMappingService.bulkUpsert).not.toHaveBeenCalled();
    });

    it('should return 400 when mappings array is missing', async () => {
      const response = await request(app).post('/api/quickbooks/mappings/bulk').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing required field: mappings (must be non-empty array)',
      });
      expect(EntityMappingService.bulkUpsert).not.toHaveBeenCalled();
    });

    it('should return 400 when mappings array is empty', async () => {
      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({ mappings: [] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing required field: mappings (must be non-empty array)',
      });
    });

    it('should return 400 when mapping row missing required fields', async () => {
      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [
            { entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' },
            { entityType: 'item', localId: 'fuel-1' }, // Missing qbId
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Mapping row 1: Missing required fields (entityType, localId, qbId)',
      });
    });

    it('should return 400 for invalid entityType in any row', async () => {
      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [
            { entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' },
            { entityType: 'invalid', localId: 'test', qbId: 'QB-456' },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Mapping row 1: Invalid entityType invalid. Must be one of: customer, payment_method, item',
      });
    });

    it('should enforce org isolation for bulk operations', async () => {
      const mockResults = [
        { success: true, entityType: 'customer' as const, localId: 'walk-in', qbId: 'QB-123' },
      ];

      (EntityMappingService.bulkUpsert as jest.Mock).mockResolvedValue(mockResults);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [
            {
              organizationId: 'attacker-org-id', // Attempt to write to different org
              entityType: 'customer',
              localId: 'walk-in',
              qbId: 'QB-123',
            },
          ],
        });

      expect(response.status).toBe(200);
      // Should use org from authenticated user, not from body
      expect(EntityMappingService.bulkUpsert).toHaveBeenCalledWith(
        'test-org-id',
        expect.arrayContaining([
          expect.objectContaining({
            entityType: 'customer',
            localId: 'walk-in',
            qbId: 'QB-123',
          }),
        ])
      );
    });

    it('should work for manager role (not just admin)', async () => {
      const mockResults = [
        { success: true, entityType: 'customer' as const, localId: 'walk-in', qbId: 'QB-123' },
      ];

      (EntityMappingService.bulkUpsert as jest.Mock).mockResolvedValue(mockResults);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      mockAuthScenario = 'manager';
      app = createTestApp();

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [{ entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' }],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Response Shape Consistency (Real Routes)', () => {
    it('GET endpoint returns deterministic response shape', async () => {
      (EntityMappingService.listMappings as jest.Mock).mockResolvedValue([]);

      const response = await request(app).get('/api/quickbooks/mappings');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('mappings');
      expect(typeof response.body.success).toBe('boolean');
      expect(typeof response.body.count).toBe('number');
      expect(Array.isArray(response.body.mappings)).toBe(true);
    });

    it('POST endpoint returns deterministic response shape', async () => {
      const mockMapping = {
        id: 'map-1',
        organizationId: 'test-org-id',
        entityType: 'customer',
        localId: 'walk-in',
        qbId: 'QB-123',
        qbName: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (EntityMappingService.upsertMapping as jest.Mock).mockResolvedValue(mockMapping);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings')
        .send({
          entityType: 'customer',
          localId: 'walk-in',
          qbId: 'QB-123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('mapping');
      expect(typeof response.body.success).toBe('boolean');
      expect(response.body.mapping).toHaveProperty('id');
      expect(response.body.mapping).toHaveProperty('organizationId');
    });

    it('POST bulk endpoint returns deterministic response shape', async () => {
      const mockResults = [
        { success: true, entityType: 'customer' as const, localId: 'walk-in', qbId: 'QB-123' },
      ];

      (EntityMappingService.bulkUpsert as jest.Mock).mockResolvedValue(mockResults);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({
          mappings: [{ entityType: 'customer', localId: 'walk-in', qbId: 'QB-123' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('totalRows');
      expect(response.body).toHaveProperty('successCount');
      expect(response.body).toHaveProperty('failureCount');
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
    });

    it('Error responses are consistent across all endpoints', async () => {
      // GET error
      const getError = await request(app)
        .get('/api/quickbooks/mappings')
        .query({ entityType: 'invalid' });
      expect(getError.status).toBe(400);
      expect(getError.body).toHaveProperty('error');
      expect(typeof getError.body.error).toBe('string');

      // POST error
      const postError = await request(app)
        .post('/api/quickbooks/mappings')
        .send({ entityType: 'invalid', localId: 'test', qbId: '123' });
      expect(postError.status).toBe(400);
      expect(postError.body).toHaveProperty('error');
      expect(typeof postError.body.error).toBe('string');

      // Bulk error
      const bulkError = await request(app)
        .post('/api/quickbooks/mappings/bulk')
        .send({ mappings: [] });
      expect(bulkError.status).toBe(400);
      expect(bulkError.body).toHaveProperty('error');
      expect(typeof bulkError.body.error).toBe('string');
    });
  });

  // ============================================================
  // Task 5: Production Hardening Tests
  // ============================================================

  describe('GET /api/quickbooks/preflight', () => {
    it('should return preflight results for admin', async () => {
      // Mock preflight service
      const {runPreflightChecks} = require('./preflight.service');
      (runPreflightChecks as jest.Mock).mockResolvedValue({
        success: true,
        overallStatus: 'ready',
        checks: [{ name: 'Test Check', status: 'pass', message: 'OK' }],
        summary: { totalChecks: 1, passed: 1, warnings: 0, failed: 0, timestamp: new Date().toISOString() }
      });

      mockAuthScenario = 'admin';
      const response = await request(app).get('/api/quickbooks/preflight');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.overallStatus).toBe('ready');
      expect(response.body.checks).toBeDefined();
      expect(response.body.summary).toBeDefined();
    });

    it('should allow manager to access preflight', async () => {
      const {runPreflightChecks} = require('./preflight.service');
      (runPreflightChecks as jest.Mock).mockResolvedValue({
        success: true,
        overallStatus: 'ready',
        checks: [],
        summary: { totalChecks: 0, passed: 0, warnings: 0, failed: 0, timestamp: new Date().toISOString() }
      });

      mockAuthScenario = 'manager';
      const response = await request(app).get('/api/quickbooks/preflight');

      expect(response.status).toBe(200);
    });

    it('should block cashier from accessing preflight', async () => {
      mockAuthScenario = 'cashier';
      const response = await request(app).get('/api/quickbooks/preflight');

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      mockAuthScenario = 'none';
      const response = await request(app).get('/api/quickbooks/preflight');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/quickbooks/controls', () => {
    it('should return current controls for admin', async () => {
      // Mock getSafetyStatus
      const {getSafetyStatus} = require('./safety-gates');
      (getSafetyStatus as jest.Mock).mockResolvedValue({
        connected: true,
        killSwitchActive: false,
        syncMode: 'READ_ONLY',
        approvalRequired: true,
        canRead: true,
        canWrite: false,
        canWriteReal: false,
        isDryRun: false,
        lastSyncAt: new Date(),
        lastSyncStatus: 'success'
      });

      mockAuthScenario = 'admin';
      const response = await request(app).get('/api/quickbooks/controls');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.controls).toBeDefined();
      expect(response.body.controls.killSwitch).toBe(false);
      expect(response.body.controls.syncMode).toBe('READ_ONLY');
      expect(response.body.status).toBeDefined();
    });

    it('should block non-admin from accessing controls', async () => {
      mockAuthScenario = 'manager';
      const response = await request(app).get('/api/quickbooks/controls');

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      mockAuthScenario = 'none';
      const response = await request(app).get('/api/quickbooks/controls');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/quickbooks/controls', () => {
    it('should update kill switch (admin only)', async () => {
      const {getSafetyStatus, activateKillSwitch} = require('./safety-gates');
      const {AuditLogger} = require('./audit-logger');

      (getSafetyStatus as jest.Mock)
        .mockResolvedValueOnce({ killSwitchActive: false, syncMode: 'READ_ONLY' })
        .mockResolvedValueOnce({ killSwitchActive: true, syncMode: 'READ_ONLY' });

      (activateKillSwitch as jest.Mock).mockResolvedValue(undefined);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ killSwitch: true, reason: 'Emergency stop' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.changes).toBeDefined();
      expect(response.body.changes.killSwitch).toEqual({ from: false, to: true });
      expect(activateKillSwitch).toHaveBeenCalledWith('test-org-id');
      expect(AuditLogger.log).toHaveBeenCalled();
    });

    it('should update sync mode (admin only)', async () => {
      const {getSafetyStatus, setSyncMode} = require('./safety-gates');
      const {AuditLogger} = require('./audit-logger');

      (getSafetyStatus as jest.Mock)
        .mockResolvedValueOnce({ killSwitchActive: false, syncMode: 'READ_ONLY' })
        .mockResolvedValueOnce({ killSwitchActive: false, syncMode: 'DRY_RUN' });

      (setSyncMode as jest.Mock).mockResolvedValue(undefined);
      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ syncMode: 'DRY_RUN', reason: 'Testing' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.changes.syncMode).toEqual({ from: 'READ_ONLY', to: 'DRY_RUN' });
      expect(setSyncMode).toHaveBeenCalledWith('test-org-id', 'DRY_RUN');
    });

    it('should be idempotent (no changes when already in desired state)', async () => {
      const {getSafetyStatus} = require('./safety-gates');
      const {AuditLogger} = require('./audit-logger');

      (getSafetyStatus as jest.Mock).mockResolvedValue({
        killSwitchActive: true,
        syncMode: 'DRY_RUN'
      });

      (AuditLogger.log as jest.Mock).mockResolvedValue(undefined);

      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ killSwitch: true, syncMode: 'DRY_RUN' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('No changes applied');
    });

    it('should validate syncMode values', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ syncMode: 'INVALID_MODE' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid syncMode');
    });

    it('should validate killSwitch type', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ killSwitch: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('killSwitch must be boolean');
    });

    it('should require at least one control to update', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Must specify at least one control');
    });

    it('should block non-admin from updating controls', async () => {
      mockAuthScenario = 'manager';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ killSwitch: true });

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      mockAuthScenario = 'none';
      const response = await request(app)
        .post('/api/quickbooks/controls')
        .send({ killSwitch: true });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/quickbooks/safety-gates/sync-mode (Legacy)', () => {
    it('should accept WRITE_ENABLED and return deprecation warning', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/safety-gates/sync-mode')
        .send({ mode: 'WRITE_ENABLED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('WRITE_ENABLED');
      expect(response.body.warning).toContain('deprecated');
      expect(response.body.actualSyncMode).toBe('FULL_SYNC');
    });

    it('should accept READ_ONLY and return deprecation warning', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/safety-gates/sync-mode')
        .send({ mode: 'READ_ONLY' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('READ_ONLY');
      expect(response.body.warning).toContain('deprecated');
      expect(response.body.actualSyncMode).toBe('READ_ONLY');
    });

    it('should reject invalid mode values', async () => {
      mockAuthScenario = 'admin';
      const response = await request(app)
        .post('/api/quickbooks/safety-gates/sync-mode')
        .send({ mode: 'INVALID' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('must be READ_ONLY or WRITE_ENABLED');
    });

    it('should allow manager role access', async () => {
      mockAuthScenario = 'manager';
      const response = await request(app)
        .post('/api/quickbooks/safety-gates/sync-mode')
        .send({ mode: 'READ_ONLY' });

      expect(response.status).toBe(200);
    });
  });
});
