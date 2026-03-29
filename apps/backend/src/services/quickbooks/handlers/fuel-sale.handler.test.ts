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
      return null;
    });

    // Mock audit logger
    (auditLogger.AuditLogger.log as jest.MockedFunction<typeof auditLogger.AuditLogger.log>).mockResolvedValue(undefined);

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
    });
  });
});
