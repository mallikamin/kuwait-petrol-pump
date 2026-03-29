/**
 * Preflight Service Tests
 * Tests production readiness validation checks
 */

import { runPreflightChecks } from './preflight.service';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
    qBConnection: {
      findFirst: jest.fn(),
    },
    qBEntityMapping: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    fuelType: {
      findMany: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('PreflightService', () => {
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new PrismaClient();

    // Default env vars for tests
    process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
    process.env.QUICKBOOKS_REDIRECT_URI = 'http://localhost:3000/callback';
    process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
    process.env.QB_TOKEN_ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012').toString('base64'); // 32 bytes
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  });

  describe('Overall Status Calculation', () => {
    it('should return ready when all checks pass', async () => {
      // Mock: DB migration exists
      prisma.$queryRaw.mockResolvedValueOnce([{ exists: true }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { column_name: 'id' },
        { column_name: 'organization_id' },
        { column_name: 'entity_type' },
        { column_name: 'local_id' },
        { column_name: 'qb_id' },
      ]);

      // Mock: Active QB connection
      prisma.qBConnection.findFirst.mockResolvedValue({
        id: '123',
        companyName: 'Test Company',
        realmId: '456',
        syncMode: 'READ_ONLY',
        globalKillSwitch: false,
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
      });

      // Mock: Walk-in customer mapping exists
      prisma.qBEntityMapping.findFirst.mockResolvedValueOnce({
        id: '1',
        localId: 'walk-in',
        qbId: 'QB-123',
        qbName: 'Walk-In Customer',
      });

      // Mock: Payment method mappings exist
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'cash', qbId: 'QB-CASH' },
        { localId: 'card', qbId: 'QB-CARD' },
      ]);

      // Mock: Fuel types exist and all mapped
      prisma.fuelType.findMany.mockResolvedValue([
        { id: 'fuel-1', code: 'PMG', name: 'Petrol' },
        { id: 'fuel-2', code: 'HSD', name: 'Diesel' },
      ]);

      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'fuel-1', qbId: 'QB-PMG' },
        { localId: 'fuel-2', qbId: 'QB-HSD' },
      ]);

      const result = await runPreflightChecks('org-123');

      expect(result.success).toBe(true);
      expect(result.overallStatus).toBe('ready');
      expect(result.summary.failed).toBe(0);
      expect(result.summary.warnings).toBe(0);
      expect(result.summary.passed).toBeGreaterThan(0);
    });

    it('should return blocked when critical checks fail', async () => {
      // Mock: DB migration missing
      prisma.$queryRaw.mockRejectedValue(new Error('Table not found'));

      const result = await runPreflightChecks('org-123');

      expect(result.success).toBe(false);
      expect(result.overallStatus).toBe('blocked');
      expect(result.summary.failed).toBeGreaterThan(0);
    });

    it('should return warning when non-critical checks fail', async () => {
      // Mock: DB migration exists
      prisma.$queryRaw.mockResolvedValueOnce([{ exists: true }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { column_name: 'id' },
        { column_name: 'organization_id' },
        { column_name: 'entity_type' },
        { column_name: 'local_id' },
        { column_name: 'qb_id' },
      ]);

      // Mock: Active QB connection
      prisma.qBConnection.findFirst.mockResolvedValue({
        id: '123',
        companyName: 'Test Company',
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        globalKillSwitch: false,
      });

      // Mock: Walk-in customer mapping exists
      prisma.qBEntityMapping.findFirst.mockResolvedValue({
        localId: 'walk-in',
        qbId: 'QB-123',
      });

      // Mock: Payment method mappings exist
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'cash', qbId: 'QB-CASH' },
        { localId: 'card', qbId: 'QB-CARD' },
      ]);

      // Mock: No fuel types (warning, not blocker)
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      expect(result.success).toBe(true);
      expect(result.overallStatus).toBe('warning');
      expect(result.summary.warnings).toBeGreaterThan(0);
    });
  });

  describe('Check 1: Database Migration', () => {
    it('should pass when qb_entity_mappings table exists with correct schema', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ exists: true }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { column_name: 'id' },
        { column_name: 'organization_id' },
        { column_name: 'entity_type' },
        { column_name: 'local_id' },
        { column_name: 'qb_id' },
      ]);

      // Mock other checks to pass
      prisma.qBConnection.findFirst.mockResolvedValue({ globalKillSwitch: false, accessTokenExpiresAt: new Date(Date.now() + 3600000), refreshTokenExpiresAt: new Date(Date.now() + 3600000) });
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const dbCheck = result.checks.find(c => c.name === 'Database Migration');
      expect(dbCheck?.status).toBe('pass');
    });

    it('should fail when qb_entity_mappings table does not exist', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Table not found'));

      const result = await runPreflightChecks('org-123');

      const dbCheck = result.checks.find(c => c.name === 'Database Migration');
      expect(dbCheck?.status).toBe('fail');
      expect(dbCheck?.message).toContain('qb_entity_mappings table not found');
    });
  });

  describe('Check 2: Environment Variables', () => {
    it('should pass when all required env vars are set', async () => {
      // All env vars set in beforeEach
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.qBConnection.findFirst.mockResolvedValue({ globalKillSwitch: false, accessTokenExpiresAt: new Date(Date.now() + 3600000), refreshTokenExpiresAt: new Date(Date.now() + 3600000) });
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const envCheck = result.checks.find(c => c.name === 'Environment Variables');
      expect(envCheck?.status).toBe('pass');
    });

    it('should fail when critical env vars are missing', async () => {
      delete process.env.QUICKBOOKS_CLIENT_ID;

      prisma.$queryRaw.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const envCheck = result.checks.find(c => c.name === 'Environment Variables');
      expect(envCheck?.status).toBe('fail');
      expect(envCheck?.message).toContain('QUICKBOOKS_CLIENT_ID');
    });

    it('should fail when encryption key is invalid', async () => {
      process.env.QB_TOKEN_ENCRYPTION_KEY = 'invalid-short-key';

      prisma.$queryRaw.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const envCheck = result.checks.find(c => c.name === 'Environment Variables');
      expect(envCheck?.status).toBe('fail');
      expect(envCheck?.message).toContain('QB_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('Check 3: QuickBooks Connection', () => {
    it('should pass when active connection exists with valid tokens', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      prisma.qBConnection.findFirst.mockResolvedValue({
        id: '123',
        companyName: 'Test Company',
        realmId: '456',
        syncMode: 'READ_ONLY',
        globalKillSwitch: false,
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
      });

      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const connCheck = result.checks.find(c => c.name === 'QuickBooks Connection');
      expect(connCheck?.status).toBe('pass');
      expect(connCheck?.message).toContain('Test Company');
    });

    it('should fail when no active connection exists', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.qBConnection.findFirst.mockResolvedValue(null);

      const result = await runPreflightChecks('org-123');

      const connCheck = result.checks.find(c => c.name === 'QuickBooks Connection');
      expect(connCheck?.status).toBe('fail');
      expect(connCheck?.message).toContain('No active QuickBooks connection');
    });

    it('should fail when kill switch is active', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      prisma.qBConnection.findFirst.mockResolvedValue({
        id: '123',
        companyName: 'Test Company',
        globalKillSwitch: true,
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
      });

      const result = await runPreflightChecks('org-123');

      const connCheck = result.checks.find(c => c.name === 'QuickBooks Connection');
      expect(connCheck?.status).toBe('fail');
      expect(connCheck?.message).toContain('KILL SWITCH');
    });

    it('should warn when access token is expired (but refresh token valid)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      prisma.qBConnection.findFirst.mockResolvedValue({
        id: '123',
        companyName: 'Test Company',
        syncMode: 'READ_ONLY',
        globalKillSwitch: false,
        accessTokenExpiresAt: new Date(Date.now() - 3600000), // Expired
        refreshTokenExpiresAt: new Date(Date.now() + 3600000), // Valid
      });

      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const connCheck = result.checks.find(c => c.name === 'QuickBooks Connection');
      expect(connCheck?.status).toBe('warning');
      expect(connCheck?.message).toContain('access token expired');
    });
  });

  describe('Check 4: Entity Mappings', () => {
    beforeEach(() => {
      // Mock DB and connection to pass
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.qBConnection.findFirst.mockResolvedValue({
        globalKillSwitch: false,
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
      });
    });

    it('should pass when walk-in customer mapping exists', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue({
        localId: 'walk-in',
        qbId: 'QB-123',
        qbName: 'Walk-In Customer',
      });

      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const walkInCheck = result.checks.find(c => c.name === 'Walk-In Customer Mapping');
      expect(walkInCheck?.status).toBe('pass');
    });

    it('should fail when walk-in customer mapping is missing', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue(null);
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const walkInCheck = result.checks.find(c => c.name === 'Walk-In Customer Mapping');
      expect(walkInCheck?.status).toBe('fail');
      expect(walkInCheck?.message).toContain('Walk-in customer mapping not found');
    });

    it('should pass when all payment methods are mapped', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'cash', qbId: 'QB-CASH' },
        { localId: 'card', qbId: 'QB-CARD' },
      ]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const pmCheck = result.checks.find(c => c.name === 'Payment Method Mappings');
      expect(pmCheck?.status).toBe('pass');
    });

    it('should fail when payment method mappings are missing', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'cash', qbId: 'QB-CASH' },
        // Missing 'card'
      ]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const pmCheck = result.checks.find(c => c.name === 'Payment Method Mappings');
      expect(pmCheck?.status).toBe('fail');
      expect(pmCheck?.message).toContain('card');
    });

    it('should pass when all fuel items are mapped', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([{ localId: 'cash' }, { localId: 'card' }]);

      prisma.fuelType.findMany.mockResolvedValue([
        { id: 'fuel-1', code: 'PMG', name: 'Petrol' },
        { id: 'fuel-2', code: 'HSD', name: 'Diesel' },
      ]);

      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'fuel-1', qbId: 'QB-PMG' },
        { localId: 'fuel-2', qbId: 'QB-HSD' },
      ]);

      const result = await runPreflightChecks('org-123');

      const fuelCheck = result.checks.find(c => c.name === 'Fuel Item Mappings');
      expect(fuelCheck?.status).toBe('pass');
    });

    it('should fail when fuel item mappings are missing', async () => {
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([{ localId: 'cash' }, { localId: 'card' }]);

      prisma.fuelType.findMany.mockResolvedValue([
        { id: 'fuel-1', code: 'PMG', name: 'Petrol' },
        { id: 'fuel-2', code: 'HSD', name: 'Diesel' },
      ]);

      prisma.qBEntityMapping.findMany.mockResolvedValueOnce([
        { localId: 'fuel-1', qbId: 'QB-PMG' },
        // Missing fuel-2
      ]);

      const result = await runPreflightChecks('org-123');

      const fuelCheck = result.checks.find(c => c.name === 'Fuel Item Mappings');
      expect(fuelCheck?.status).toBe('fail');
      expect(fuelCheck?.message).toContain('Diesel');
    });
  });

  describe('Check 5: Redis Connectivity', () => {
    it('should pass when Redis is accessible and responds to ping', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.qBConnection.findFirst.mockResolvedValue({ globalKillSwitch: false, accessTokenExpiresAt: new Date(Date.now() + 3600000), refreshTokenExpiresAt: new Date(Date.now() + 3600000) });
      prisma.qBEntityMapping.findFirst.mockResolvedValue({ localId: 'walk-in' });
      prisma.qBEntityMapping.findMany.mockResolvedValue([{ localId: 'cash' }, { localId: 'card' }]);
      prisma.fuelType.findMany.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const redisCheck = result.checks.find(c => c.name === 'Redis Connectivity');
      expect(redisCheck?.status).toBe('pass');
    });

    it('should fail when REDIS_URL is not configured', async () => {
      delete process.env.REDIS_URL;

      prisma.$queryRaw.mockResolvedValue([]);

      const result = await runPreflightChecks('org-123');

      const redisCheck = result.checks.find(c => c.name === 'Redis Connectivity');
      expect(redisCheck?.status).toBe('fail');
      expect(redisCheck?.message).toContain('REDIS_URL not configured');
    });
  });
});
