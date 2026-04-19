/**
 * Tests for QuickBooks Fuel Sale Handler
 *
 * Tests all critical paths:
 * - Successful SalesReceipt creation
 * - Missing QB connection
 * - Token refresh flow
 * - Token refresh failure
 * - QB API errors
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { handleFuelSaleCreate, FuelSalePayload } from './fuel-sale.handler';
import { QBSyncQueue } from '@prisma/client';
import * as encryption from '../encryption';
import * as safetyGates from '../safety-gates';
import * as auditLogger from '../audit-logger';
import * as companyLock from '../company-lock';
import * as entityMapping from '../entity-mapping.service';

// Mock modules
jest.mock('../../../config/database', () => ({
  prisma: {
    qBConnection: {
      findFirst: jest.fn(),
      update: jest.fn()
    },
    product: {
      findFirst: jest.fn()
    },
    sale: {
      update: jest.fn().mockResolvedValue({})
    }
  }
}));
jest.mock('../encryption');
jest.mock('../safety-gates');
jest.mock('../audit-logger');
jest.mock('../company-lock');
jest.mock('../entity-mapping.service');

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Import mocked prisma
import { prisma } from '../../../config/database';

describe('Fuel Sale Handler', () => {
  let mockJob: QBSyncQueue;
  let mockPayload: FuelSalePayload;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock safety gates
    (safetyGates.checkKillSwitch as jest.MockedFunction<typeof safetyGates.checkKillSwitch>).mockResolvedValue(undefined);
    (safetyGates.checkSyncMode as jest.MockedFunction<typeof safetyGates.checkSyncMode>).mockResolvedValue(undefined);

    // Mock company lock
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>).mockResolvedValue(undefined);
    (companyLock.CompanyLock.lockConnectionToOrganization as jest.MockedFunction<typeof companyLock.CompanyLock.lockConnectionToOrganization>).mockResolvedValue(undefined);

    // Mock entity mapping service (return valid mappings by default)
    (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<typeof entityMapping.EntityMappingService.getQbId>).mockImplementation(async (orgId, type, localId) => {
      // Return mock QB IDs for all entities
      if (type === 'customer' && localId === 'walk-in') return 'QB-CUSTOMER-WALKIN';
      if (type === 'payment_method' && localId === 'cash') return 'QB-PAYMENT-CASH';
      if (type === 'item' && localId === 'fuel-1') return 'QB-ITEM-FUEL1';
      if (type === 'item' && localId === 'tax') return 'QB-ITEM-TAX';
      if (type === 'bank_account' && localId === 'cash') return 'QB-CASH-IN-HAND';
      return null;
    });

    // Mock audit logger
    (auditLogger.AuditLogger.log as jest.MockedFunction<typeof auditLogger.AuditLogger.log>).mockResolvedValue(undefined);

    // Default: fuel/static localIds don't resolve to a product row (pass-through to direct mapping).
    // Non-fuel regression tests override this mock per-case to simulate a real product UUID.
    (prisma.product.findFirst as jest.MockedFunction<any>).mockResolvedValue(null);

    // Setup test job
    mockJob = {
      id: 'job-123',
      connectionId: 'conn-123',
      organizationId: 'org-123',
      jobType: 'create_sales_receipt',
      entityType: 'sale',
      entityId: 'sale-456',
      priority: 5,
      status: 'pending',
      payload: null,
      result: null,
      errorMessage: null,
      errorCode: null,
      errorDetail: null,
      httpStatusCode: null,
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      idempotencyKey: null,
      batchId: null,
      checkpointId: null,
      approvalStatus: 'approved',
      approvedBy: null,
      approvedAt: null,
      replayableFromBatch: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as QBSyncQueue;

    // Setup test payload
    mockPayload = {
      saleId: 'sale-456',
      organizationId: 'org-123',
      txnDate: '2026-03-29',
      paymentMethod: 'cash',
      lineItems: [
        {
          fuelTypeId: 'fuel-1',
          fuelTypeName: 'Premium 95',
          quantity: 50.0,
          unitPrice: 0.5,
          amount: 25.0
        }
      ],
      totalAmount: 25.0
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create SalesReceipt successfully', async () => {
    // Mock QB connection
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock token decryption
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
      .mockReturnValue('valid-access-token');

    // Mock successful QB API response
    const mockQBResponse = {
      SalesReceipt: {
        Id: '789',
        DocNumber: 'SR-1001',
        TxnDate: '2026-03-29',
        TotalAmt: 25.0
      }
    };

    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockQBResponse
    } as Response);

    // Execute handler
    const result = await handleFuelSaleCreate(mockJob, mockPayload);

    // Verify result
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('789');
    expect(result.qbDocNumber).toBe('SR-1001');

    // Verify safety gates checked
    expect(safetyGates.checkKillSwitch).toHaveBeenCalledWith('org-123');
    expect(safetyGates.checkSyncMode).toHaveBeenCalledWith('org-123');

    // Verify QB connection fetched
    expect(prisma.qBConnection.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-123',
        isActive: true
      }
    });

    // Verify QB API called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v3/company/realm-123/salesreceipt'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer valid-access-token'
        })
      })
    );

    // Verify success audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'SUCCESS',
        entity_id: 'sale-456'
      })
    );
  });

  it('should throw error when QB connection missing', async () => {
    // Mock no connection found
    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(null);

    // Execute and expect error
    await expect(handleFuelSaleCreate(mockJob, mockPayload))
      .rejects
      .toThrow('QuickBooks not connected for this organization');

    // Verify failure audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'FAILURE',
        error_message: 'QuickBooks not connected for this organization'
      })
    );
  });

  it('should refresh expired token and retry', async () => {
    // Mock QB connection with expired token
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-old-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock token decryption
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
      .mockReturnValue('old-refresh-token');

    // Mock token encryption
    (encryption.encryptToken as jest.MockedFunction<typeof encryption.encryptToken>)
      .mockReturnValueOnce('encrypted-new-access')
      .mockReturnValueOnce('encrypted-new-refresh');

    // Mock token update
    (prisma.qBConnection.update as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock token refresh response
    const mockTokenResponse = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400
    };

    // Mock successful QB API responses
    const mockQBResponse = {
      SalesReceipt: {
        Id: '789',
        DocNumber: 'SR-1001'
      }
    };

    // Setup fetch mock to return different responses
    (global.fetch as jest.MockedFunction<typeof fetch>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTokenResponse
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockQBResponse
      } as Response);

    // Execute handler
    const result = await handleFuelSaleCreate(mockJob, mockPayload);

    // Verify result
    expect(result.success).toBe(true);
    expect(result.qbId).toBe('789');

    // Verify token refresh called
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      expect.objectContaining({
        method: 'POST'
      })
    );

    // Verify token update
    expect(prisma.qBConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-123' },
      data: expect.objectContaining({
        accessTokenEncrypted: 'encrypted-new-access',
        refreshTokenEncrypted: 'encrypted-new-refresh'
      })
    });

    // Verify QB API called with new token
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/salesreceipt'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer new-access-token'
        })
      })
    );
  });

  it('should fail when token refresh fails', async () => {
    // Mock QB connection with expired token
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-old-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock token decryption
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
      .mockReturnValue('old-refresh-token');

    // Mock failed token refresh (401 Unauthorized)
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid refresh token'
    } as Response);

    // Execute and expect error
    await expect(handleFuelSaleCreate(mockJob, mockPayload))
      .rejects
      .toThrow('Token refresh failed: 401 Unauthorized');

    // Verify failure audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'FAILURE',
        error_message: expect.stringContaining('Token refresh failed')
      })
    );
  });

  it('should throw error on QB API non-2xx response', async () => {
    // Mock QB connection
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock token decryption
    (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
      .mockReturnValue('valid-access-token');

    // Mock QB API error response (400 Bad Request)
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({
        Fault: {
          Error: [{
            Message: 'Invalid customer reference',
            Detail: 'Customer with ID 1 not found'
          }]
        }
      })
    } as Response);

    // Execute and expect error
    await expect(handleFuelSaleCreate(mockJob, mockPayload))
      .rejects
      .toThrow('QB API error: 400 Bad Request');

    // Verify failure audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'FAILURE',
        error_message: expect.stringContaining('QB API error: 400')
      })
    );
  });

  it('should throw error for missing required fields', async () => {
    // Test missing saleId
    const invalidPayload = { ...mockPayload, saleId: '' };

    await expect(handleFuelSaleCreate(mockJob, invalidPayload))
      .rejects
      .toThrow('Missing required field: saleId');
  });

  it('should throw error for organization mismatch', async () => {
    // Modify payload to have different organization
    const mismatchPayload = { ...mockPayload, organizationId: 'different-org' };

    await expect(handleFuelSaleCreate(mockJob, mismatchPayload))
      .rejects
      .toThrow('Organization mismatch');
  });

  it('should throw error for empty line items', async () => {
    // Test empty line items
    const invalidPayload = { ...mockPayload, lineItems: [] };

    await expect(handleFuelSaleCreate(mockJob, invalidPayload))
      .rejects
      .toThrow('Missing required field: lineItems');
  });

  it('should throw error when company lock validation fails', async () => {
    // Mock QB connection
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock company lock validation failure
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>)
      .mockRejectedValue(new Error('RealmId mismatch: Expected realm-123, got realm-456. WRITE BLOCKED.'));

    // Execute and expect error
    await expect(handleFuelSaleCreate(mockJob, mockPayload))
      .rejects
      .toThrow('RealmId mismatch');

    // Verify company lock was checked
    expect(companyLock.CompanyLock.validateRealmId).toHaveBeenCalledWith('conn-123', 'realm-123');

    // Verify failure audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'FAILURE',
        error_message: expect.stringContaining('RealmId mismatch')
      })
    );
  });

  it('should throw error when connection-to-org lock validation fails', async () => {
    // Mock QB connection
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      isActive: true
    };

    (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

    // Mock successful validateRealmId but failed lockConnectionToOrganization
    (companyLock.CompanyLock.validateRealmId as jest.MockedFunction<typeof companyLock.CompanyLock.validateRealmId>)
      .mockResolvedValue(undefined);

    (companyLock.CompanyLock.lockConnectionToOrganization as jest.MockedFunction<typeof companyLock.CompanyLock.lockConnectionToOrganization>)
      .mockRejectedValue(new Error('Organization mismatch: Connection conn-123 belongs to org org-456, not org-123'));

    // Execute and expect error
    await expect(handleFuelSaleCreate(mockJob, mockPayload))
      .rejects
      .toThrow('Organization mismatch: Connection conn-123 belongs to org org-456, not org-123');

    // Verify both lock methods were called
    expect(companyLock.CompanyLock.validateRealmId).toHaveBeenCalledWith('conn-123', 'realm-123');
    expect(companyLock.CompanyLock.lockConnectionToOrganization).toHaveBeenCalledWith('conn-123', 'org-123');

    // Verify failure audit log
    expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE_SALES_RECEIPT',
        status: 'FAILURE',
        error_message: expect.stringContaining('Organization mismatch')
      })
    );
  });

  describe('Entity Mapping Integration', () => {
    it('should successfully create SalesReceipt with all mappings present', async () => {
      // Mock QB connection
      const mockConnection = {
        id: 'conn-123',
        organizationId: 'org-123',
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted-access-token',
        refreshTokenEncrypted: 'encrypted-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        isActive: true
      };

      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

      // Mock token decryption
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
        .mockReturnValue('valid-access-token');

      // Mock entity mapping lookups (all succeed)
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(async (orgId, type, localId) => {
          if (type === 'customer' && localId === 'walk-in') return 'QB-CUSTOMER-1';
          if (type === 'payment_method' && localId === 'cash') return 'QB-PAYMENT-1';
          if (type === 'item' && localId === 'fuel-1') return 'QB-ITEM-95';
          if (type === 'bank_account' && localId === 'cash') return 'QB-CASH-IN-HAND';
          return null;
        });

      // Mock successful QB API response
      const mockQBResponse = {
        SalesReceipt: {
          Id: '789',
          DocNumber: 'SR-1001',
          TxnDate: '2026-03-29',
          TotalAmt: 25.0
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockQBResponse
      } as Response);

      // Execute handler
      const result = await handleFuelSaleCreate(mockJob, mockPayload);

      // Verify result
      expect(result.success).toBe(true);
      expect(result.qbId).toBe('789');
      expect(result.qbDocNumber).toBe('SR-1001');

      // Verify entity mapping service was called
      expect(entityMapping.EntityMappingService.getQbId).toHaveBeenCalledWith('org-123', 'customer', 'walk-in');
      expect(entityMapping.EntityMappingService.getQbId).toHaveBeenCalledWith('org-123', 'payment_method', 'cash');
      expect(entityMapping.EntityMappingService.getQbId).toHaveBeenCalledWith('org-123', 'item', 'fuel-1');

      // Verify QB API was called with mapped IDs (not hardcoded refs)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/salesreceipt'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('QB-CUSTOMER-1') // Mapped customer ID
        })
      );
    });

    it('should fail fast when customer mapping is missing', async () => {
      // Mock QB connection
      const mockConnection = {
        id: 'conn-123',
        organizationId: 'org-123',
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted-access-token',
        refreshTokenEncrypted: 'encrypted-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        isActive: true
      };

      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

      // Mock token decryption
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
        .mockReturnValue('valid-access-token');

      // Mock entity mapping - customer mapping missing
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(async (orgId, type, localId) => {
          if (type === 'customer') return null; // Missing customer mapping
          if (type === 'payment_method') return 'QB-PAYMENT-1';
          if (type === 'item') return 'QB-ITEM-95';
          return null;
        });

      // Execute and expect error
      await expect(handleFuelSaleCreate(mockJob, mockPayload))
        .rejects
        .toThrow(/Walk-in customer mapping not found.*walk-in/);

      // Verify QB API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();

      // Verify failure audit log
      expect(auditLogger.AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'CREATE_SALES_RECEIPT',
          status: 'FAILURE',
          error_message: expect.stringContaining('Walk-in customer mapping not found')
        })
      );
    });

    it('should fail fast when payment method mapping is missing', async () => {
      // Mock QB connection
      const mockConnection = {
        id: 'conn-123',
        organizationId: 'org-123',
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted-access-token',
        refreshTokenEncrypted: 'encrypted-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        isActive: true
      };

      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

      // Mock token decryption
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
        .mockReturnValue('valid-access-token');

      // Mock entity mapping - payment method mapping missing
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(async (orgId, type, localId) => {
          if (type === 'customer') return 'QB-CUSTOMER-1';
          if (type === 'payment_method') return null; // Missing payment method mapping
          if (type === 'item') return 'QB-ITEM-95';
          return null;
        });

      // Execute and expect error
      await expect(handleFuelSaleCreate(mockJob, mockPayload))
        .rejects
        .toThrow(/Payment method mapping not found.*cash/);

      // Verify QB API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fail fast when item mapping is missing', async () => {
      // Mock QB connection
      const mockConnection = {
        id: 'conn-123',
        organizationId: 'org-123',
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted-access-token',
        refreshTokenEncrypted: 'encrypted-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        isActive: true
      };

      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

      // Mock token decryption
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
        .mockReturnValue('valid-access-token');

      // Mock entity mapping - item mapping missing
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(async (orgId, type, localId) => {
          if (type === 'customer') return 'QB-CUSTOMER-1';
          if (type === 'payment_method') return 'QB-PAYMENT-1';
          if (type === 'bank_account' && localId === 'cash') return 'QB-CASH-IN-HAND';
          if (type === 'item') return null; // Missing item mapping
          return null;
        });

      // Execute and expect error
      await expect(handleFuelSaleCreate(mockJob, mockPayload))
        .rejects
        .toThrow(/Item mapping not found.*fuel-1/);

      // Verify QB API was NOT called
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should verify no hardcoded QB IDs remain in payload', async () => {
      // Mock QB connection
      const mockConnection = {
        id: 'conn-123',
        organizationId: 'org-123',
        realmId: 'realm-123',
        accessTokenEncrypted: 'encrypted-access-token',
        refreshTokenEncrypted: 'encrypted-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        isActive: true
      };

      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);

      // Mock token decryption
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>)
        .mockReturnValue('valid-access-token');

      // Mock entity mapping lookups
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(async (orgId, type, localId) => {
          if (type === 'customer' && localId === 'walk-in') return 'QB-CUST-DYNAMIC';
          if (type === 'payment_method' && localId === 'cash') return 'QB-PAY-DYNAMIC';
          if (type === 'item' && localId === 'fuel-1') return 'QB-ITEM-DYNAMIC';
          if (type === 'bank_account' && localId === 'cash') return 'QB-CASH-IN-HAND';
          return null;
        });

      // Mock successful QB API response
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          SalesReceipt: {
            Id: '999',
            DocNumber: 'SR-9999'
          }
        })
      } as Response);

      // Execute handler
      await handleFuelSaleCreate(mockJob, mockPayload);

      // Verify QB API call payload
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String)
        })
      );

      // Get the actual payload sent to QB API
      const fetchCall = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);

      // Verify NO hardcoded IDs (not "1", "2", etc.)
      expect(requestBody.CustomerRef.value).not.toBe('1');
      expect(requestBody.PaymentMethodRef.value).not.toBe('1');
      expect(requestBody.PaymentMethodRef.value).not.toBe('2');

      // Verify ItemRef uses value (not name)
      expect(requestBody.Line[0].SalesItemLineDetail.ItemRef.value).toBeDefined();
      expect(requestBody.Line[0].SalesItemLineDetail.ItemRef.name).toBeUndefined();

      // Verify all refs use mapped IDs
      expect(requestBody.CustomerRef.value).toBe('QB-CUST-DYNAMIC');
      expect(requestBody.PaymentMethodRef.value).toBe('QB-PAY-DYNAMIC');
      expect(requestBody.Line[0].SalesItemLineDetail.ItemRef.value).toBe('QB-ITEM-DYNAMIC');
      // Cash SalesReceipt must carry DepositToAccountRef (Cash in Hand), not Undeposited Funds.
      expect(requestBody.DepositToAccountRef.value).toBe('QB-CASH-IN-HAND');
    });
  });

  // ── Phase 1 routing (S1..S7) ──────────────────────────────────────────────
  // Cash posts to SalesReceipt. Every AR-flavoured payment method posts to
  // Invoice with a specific customer localId. These tests assert the routing
  // decision AND the customer mapping that each branch uses.
  describe('Payment-method routing: SalesReceipt vs Invoice', () => {
    const mockConnection = {
      id: 'conn-123',
      organizationId: 'org-123',
      realmId: 'realm-123',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      isActive: true,
    };

    const runWithMappings = async (
      method: string,
      customerId: string | undefined,
      mappingResolver: (type: string, localId: string) => string | null,
      qbResponse: any,
    ) => {
      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('valid-access-token');
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
        async (_orgId: string, type: string, localId: string) => mappingResolver(type, localId),
      );
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => qbResponse,
      } as Response);

      const payload = { ...mockPayload, paymentMethod: method, customerId };
      return handleFuelSaleCreate(mockJob, payload);
    };

    it('S1..S3: paymentMethod=cash posts to /salesreceipt with walk-in customer and Cash-in-Hand deposit', async () => {
      const result = await runWithMappings('cash', undefined, (type, id) => {
        if (type === 'customer' && id === 'walk-in') return 'QB-CUSTOMER-WALKIN';
        if (type === 'payment_method' && id === 'cash') return 'QB-PM-CASH';
        if (type === 'item' && id === 'fuel-1') return 'QB-ITEM-HSD';
        if (type === 'bank_account' && id === 'cash') return 'QB-CASH-IN-HAND';
        return null;
      }, { SalesReceipt: { Id: '101', DocNumber: 'SR-101' } });

      expect(result.success).toBe(true);
      expect(result.qbEntity).toBe('SalesReceipt');
      expect(result.qbId).toBe('101');
      const [url] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect(url as string).toContain('/salesreceipt');
      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(body.CustomerRef.value).toBe('QB-CUSTOMER-WALKIN');
      // Workbook S1–S3: Cash SalesReceipt must deposit to Cash in Hand, not Undeposited Funds.
      expect(body.DepositToAccountRef.value).toBe('QB-CASH-IN-HAND');
    });

    it('S4..S6 (credit customer): paymentMethod=credit_customer posts to /invoice with the real customer', async () => {
      const result = await runWithMappings('credit_customer', 'customer-abc', (type, id) => {
        if (type === 'customer' && id === 'customer-abc') return 'QB-CUSTOMER-ABC';
        if (type === 'payment_method' && id === 'credit_customer') return 'QB-PM-CREDIT';
        if (type === 'item' && id === 'fuel-1') return 'QB-ITEM-HSD';
        return null;
      }, { Invoice: { Id: '202', DocNumber: 'INV-202' } });

      expect(result.success).toBe(true);
      expect(result.qbEntity).toBe('Invoice');
      const [url] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect(url as string).toContain('/invoice');
      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(body.CustomerRef.value).toBe('QB-CUSTOMER-ABC');
      // Invoices don't carry DepositToAccountRef — no money moved at invoice time.
      expect(body.DepositToAccountRef).toBeUndefined();
    });

    it('S4..S6 (bank card): paymentMethod=bank_card posts to /invoice against bank-card-receivable', async () => {
      // Card-type methods normalize to 'credit_card' for QB PaymentMethodRef lookup
      // (shared QB id 4). The customer sub-ledger is what distinguishes them.
      const result = await runWithMappings('bank_card', undefined, (type, id) => {
        if (type === 'customer' && id === 'bank-card-receivable') return 'QB-CUSTOMER-BCR';
        if (type === 'payment_method' && id === 'credit_card') return 'QB-PM-CREDITCARD';
        if (type === 'item' && id === 'fuel-1') return 'QB-ITEM-HSD';
        return null;
      }, { Invoice: { Id: '203', DocNumber: 'INV-203' } });

      expect(result.qbEntity).toBe('Invoice');
      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(body.CustomerRef.value).toBe('QB-CUSTOMER-BCR');
    });

    it('S7: paymentMethod=pso_card posts to /invoice against pso-card-receivable', async () => {
      // Same: pso_card normalizes to 'credit_card' for QB PaymentMethodRef
      const result = await runWithMappings('pso_card', undefined, (type, id) => {
        if (type === 'customer' && id === 'pso-card-receivable') return 'QB-CUSTOMER-PSO';
        if (type === 'payment_method' && id === 'credit_card') return 'QB-PM-CREDITCARD';
        if (type === 'item' && id === 'fuel-1') return 'QB-ITEM-HSD';
        return null;
      }, { Invoice: { Id: '204', DocNumber: 'INV-204' } });

      expect(result.qbEntity).toBe('Invoice');
      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(body.CustomerRef.value).toBe('QB-CUSTOMER-PSO');
    });

    it('normalizes aliases: "CASH" → cash → SalesReceipt; "pso" → pso_card → Invoice', async () => {
      const a = await runWithMappings('CASH', undefined, (type, id) => {
        if (type === 'customer' && id === 'walk-in') return 'QB-C-W';
        if (type === 'payment_method' && id === 'cash') return 'QB-PM-C';
        if (type === 'item' && id === 'fuel-1') return 'QB-I-H';
        if (type === 'bank_account' && id === 'cash') return 'QB-CASH-IN-HAND';
        return null;
      }, { SalesReceipt: { Id: '1', DocNumber: 'SR-1' } });
      expect(a.qbEntity).toBe('SalesReceipt');

      jest.clearAllMocks();
      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('t');
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
        async (_o: string, type: string, id: string) => {
          if (type === 'customer' && id === 'pso-card-receivable') return 'QB-C-PSO';
          if (type === 'payment_method' && id === 'credit_card') return 'QB-PM-CREDITCARD';
          if (type === 'item' && id === 'fuel-1') return 'QB-I-H';
          return null;
        },
      );
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true, status: 200, json: async () => ({ Invoice: { Id: '2', DocNumber: 'INV-2' } }),
      } as Response);

      const b = await handleFuelSaleCreate(mockJob, { ...mockPayload, paymentMethod: 'pso' });
      expect(b.qbEntity).toBe('Invoice');
    });

    it('fails fast for AR path when bank-card-receivable customer mapping is missing', async () => {
      await expect(runWithMappings('bank_card', undefined, (type, id) => {
        // bank-card-receivable deliberately missing
        if (type === 'payment_method' && id === 'credit_card') return 'QB-PM';
        if (type === 'item' && id === 'fuel-1') return 'QB-I';
        return null;
      }, {})).rejects.toThrow(/Customer mapping not found for Invoice.*bank-card-receivable/);
    });

    it('fails fast for pso_card when pso-card-receivable customer mapping is missing', async () => {
      await expect(runWithMappings('pso_card', undefined, (type, id) => {
        if (type === 'payment_method' && id === 'credit_card') return 'QB-PM';
        if (type === 'item' && id === 'fuel-1') return 'QB-I';
        return null;
      }, {})).rejects.toThrow(/localId=pso-card-receivable/);
    });

    it('fails fast for credit_customer when payload omits customerId', async () => {
      await expect(runWithMappings('credit_customer', undefined, () => null, {}))
        .rejects.toThrow(/credit_customer sale requires customerId/);
    });

    it('throws for an unknown payment-method alias', async () => {
      await expect(runWithMappings('gift-card', undefined, () => null, {}))
        .rejects.toThrow(/Unknown paymentMethod/);
    });

    it('bank_card and pso_card share PaymentMethodRef(4) but route to DIFFERENT AR customers', async () => {
      // Lock the distinction: card-type payments collapse at the QB PaymentMethod
      // layer (all use qb_id=4 "Credit Card") but stay separate at the Customer
      // layer, which is what the AR sub-ledger and reconciliation reports key on.
      const pmLookups: string[] = [];
      const custLookups: string[] = [];

      const mkMock = (expectedCustomer: string, qbCustomer: string) =>
        async (_o: string, type: string, id: string) => {
          if (type === 'payment_method') { pmLookups.push(id); }
          if (type === 'customer') { custLookups.push(id); }
          if (type === 'customer' && id === expectedCustomer) return qbCustomer;
          if (type === 'payment_method' && id === 'credit_card') return 'QB-PM-CREDITCARD';
          if (type === 'item' && id === 'fuel-1') return 'QB-I';
          return null;
        };

      // bank_card → Bank Card Receivable
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(mkMock('bank-card-receivable', 'QB-BCR-17'));
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true, status: 200, json: async () => ({ Invoice: { Id: 'I1', DocNumber: 'INV-1' } }),
      } as Response);
      await handleFuelSaleCreate(mockJob, { ...mockPayload, paymentMethod: 'bank_card' });
      const bankCardBody = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(bankCardBody.CustomerRef.value).toBe('QB-BCR-17');
      expect(bankCardBody.PaymentMethodRef.value).toBe('QB-PM-CREDITCARD');

      // pso_card → PSO Card Receivables (different customer, same PM)
      jest.clearAllMocks();
      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('t');
      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>)
        .mockImplementation(mkMock('pso-card-receivable', 'QB-PCR-55'));
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true, status: 200, json: async () => ({ Invoice: { Id: 'I2', DocNumber: 'INV-2' } }),
      } as Response);
      await handleFuelSaleCreate(mockJob, { ...mockPayload, paymentMethod: 'pso_card' });
      const psoBody = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(psoBody.CustomerRef.value).toBe('QB-PCR-55');
      expect(psoBody.PaymentMethodRef.value).toBe('QB-PM-CREDITCARD');

      // AR sub-ledgers are distinct (different CustomerRef values) even though
      // PaymentMethodRef is identical — exactly what the workbook specifies.
      expect(bankCardBody.CustomerRef.value).not.toBe(psoBody.CustomerRef.value);
      expect(bankCardBody.PaymentMethodRef.value).toBe(psoBody.PaymentMethodRef.value);

      // Both lookups passed 'credit_card' as the payment_method localId
      expect(pmLookups).not.toContain('bank_card');
      expect(pmLookups).not.toContain('pso_card');
    });

    it('non-fuel product UUID resolves via "non-fuel-item" alias → QB item 82 (accountant decision 2026-04-19)', async () => {
      // All 87 non-fuel products collapse to a single QB "Sales of Product
      // Income" item (qb_id=82). A single alias mapping (localId='non-fuel-item')
      // is seeded; any product UUID must be routed through it.
      const productUuid = 'prod-uuid-aaaa-bbbb';
      const itemLookups: string[] = [];

      (prisma.product.findFirst as jest.MockedFunction<any>).mockResolvedValue({ id: productUuid });

      const result = await runWithMappings('cash', undefined, (type, id) => {
        if (type === 'item') itemLookups.push(id);
        if (type === 'customer' && id === 'walk-in') return 'QB-WALKIN';
        if (type === 'payment_method' && id === 'cash') return 'QB-PM-CASH';
        if (type === 'item' && id === 'non-fuel-item') return '82';
        if (type === 'bank_account' && id === 'cash') return 'QB-CASH';
        return null;
      }, { SalesReceipt: { Id: 'SR-NF', DocNumber: 'SR-NF' } });

      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(result.success).toBe(true);
      expect(body.Line[0].SalesItemLineDetail.ItemRef.value).toBe('82');

      // The handler MUST have looked up the alias, not the raw product UUID.
      expect(itemLookups).toContain('non-fuel-item');
      expect(itemLookups).not.toContain(productUuid);
    });

    it('fuel type UUID passes through unchanged → direct qb_id (NOT routed via non-fuel alias)', async () => {
      // Regression: fuel lookups must NOT be incorrectly routed through the
      // non-fuel alias. HSD/PMG UUIDs have explicit mappings to qb_ids 105/106
      // and must resolve directly.
      const hsdUuid = 'a2222222-2222-2222-2222-222222222222';
      const itemLookups: string[] = [];

      // Fuel UUID is NOT in the products table (it's in fuel_types).
      (prisma.product.findFirst as jest.MockedFunction<any>).mockResolvedValue(null);
      (prisma.qBConnection.findFirst as jest.MockedFunction<any>).mockResolvedValue(mockConnection as any);
      (encryption.decryptToken as jest.MockedFunction<typeof encryption.decryptToken>).mockReturnValue('t');

      (entityMapping.EntityMappingService.getQbId as jest.MockedFunction<any>).mockImplementation(
        async (_o: string, type: string, id: string) => {
          if (type === 'item') itemLookups.push(id);
          if (type === 'customer' && id === 'walk-in') return 'QB-WALKIN';
          if (type === 'payment_method' && id === 'cash') return 'QB-PM-CASH';
          if (type === 'item' && id === hsdUuid) return '105';
          if (type === 'bank_account' && id === 'cash') return 'QB-CASH';
          return null;
        }
      );
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ SalesReceipt: { Id: 'SR-F', DocNumber: 'SR-F' } }),
      } as Response);

      const payload = {
        ...mockPayload,
        paymentMethod: 'cash',
        lineItems: [{
          fuelTypeId: hsdUuid, fuelTypeName: 'HSD', quantity: 50, unitPrice: 5, amount: 250,
        }],
        totalAmount: 250,
      };
      await handleFuelSaleCreate(mockJob, payload);

      const body = JSON.parse(((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1] as any).body);
      expect(body.Line[0].SalesItemLineDetail.ItemRef.value).toBe('105');

      // Critical: fuel UUID must resolve DIRECTLY, never through the alias.
      expect(itemLookups).toContain(hsdUuid);
      expect(itemLookups).not.toContain('non-fuel-item');
    });
  });
});
