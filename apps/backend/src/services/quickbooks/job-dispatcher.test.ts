/**
 * Job Dispatcher Tests
 *
 * Verifies:
 * - Supported paths route correctly
 * - Unsupported paths throw explicit errors
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { QBSyncQueue } from '@prisma/client';

// Mock the fuel sale handler
jest.mock('./handlers/fuel-sale.handler');

// Import after mocking
import { dispatch } from './job-dispatcher';
import * as fuelSaleHandler from './handlers/fuel-sale.handler';

describe('Job Dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Supported Paths', () => {
    it('should dispatch sale/create_sales_receipt to fuel sale handler (string payload)', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'sale-1',
        jobType: 'create_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: JSON.stringify({
          saleId: 'sale-1',
          organizationId: 'org-1',
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
        })
      } as QBSyncQueue;

      // Mock handler response
      const mockHandlerResult = {
        success: true,
        qbId: 'QB-789',
        qbDocNumber: 'SR-1001'
      };

      (fuelSaleHandler.handleFuelSaleCreate as jest.MockedFunction<typeof fuelSaleHandler.handleFuelSaleCreate>)
        .mockResolvedValue(mockHandlerResult);

      // Execute dispatcher
      const result = await dispatch(mockJob);

      // Verify handler was called with correct arguments
      expect(fuelSaleHandler.handleFuelSaleCreate).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({
          saleId: 'sale-1',
          organizationId: 'org-1',
          totalAmount: 25.0
        })
      );

      // Verify result
      expect(result.success).toBe(true);
      expect(result.qbId).toBe('QB-789');
      expect(result.qbDocNumber).toBe('SR-1001');
    });

    it('should handle object payload (Prisma JSONB)', async () => {
      const mockPayload = {
        saleId: 'sale-1',
        organizationId: 'org-1',
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

      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'sale-1',
        jobType: 'create_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: mockPayload // Prisma returns object directly
      } as QBSyncQueue;

      // Mock handler response
      const mockHandlerResult = {
        success: true,
        qbId: 'QB-789',
        qbDocNumber: 'SR-1001'
      };

      (fuelSaleHandler.handleFuelSaleCreate as jest.MockedFunction<typeof fuelSaleHandler.handleFuelSaleCreate>)
        .mockResolvedValue(mockHandlerResult);

      // Execute dispatcher
      const result = await dispatch(mockJob);

      // Verify handler was called with correct payload
      expect(fuelSaleHandler.handleFuelSaleCreate).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({
          saleId: 'sale-1',
          organizationId: 'org-1',
          totalAmount: 25.0
        })
      );

      // Verify result
      expect(result.success).toBe(true);
    });

    it('should throw explicit error for malformed JSON string', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'sale-1',
        jobType: 'create_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: '{bad json' // Malformed JSON
      } as QBSyncQueue;

      await expect(dispatch(mockJob)).rejects.toThrow(
        /Invalid JSON payload:/
      );
    });

    it('should throw error for null payload', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'sale-1',
        jobType: 'create_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: null
      } as QBSyncQueue;

      await expect(dispatch(mockJob)).rejects.toThrow(
        'Invalid payload: must be JSON string or object'
      );
    });

    it('should throw error for invalid payload type', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'sale-1',
        jobType: 'create_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: 12345 // Invalid: number
      } as any;

      await expect(dispatch(mockJob)).rejects.toThrow(
        'Invalid payload: must be JSON string or object'
      );
    });
  });

  describe('Unsupported Paths', () => {
    it('should throw explicit error for unknown entityType', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'unknown',
        entityId: 'entity-1',
        jobType: 'create_something',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: '{}'
      } as QBSyncQueue;

      await expect(dispatch(mockJob)).rejects.toThrow(
        'Unsupported dispatch path: entityType=unknown, jobType=create_something'
      );
    });

    it('should throw explicit error for unknown jobType', async () => {
      const mockJob = {
        id: 'job-1',
        entityType: 'sale',
        entityId: 'entity-1',
        jobType: 'delete_sales_receipt',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: '{}'
      } as QBSyncQueue;

      await expect(dispatch(mockJob)).rejects.toThrow(
        'Unsupported dispatch path: entityType=sale, jobType=delete_sales_receipt'
      );
    });
  });
});
