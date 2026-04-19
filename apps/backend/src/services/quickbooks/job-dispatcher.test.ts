/**
 * Job Dispatcher Tests
 *
 * Verifies:
 * - Supported paths route correctly
 * - Unsupported paths throw explicit errors
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { QBSyncQueue } from '@prisma/client';

// Mock every handler the dispatcher can route to.
jest.mock('./handlers/fuel-sale.handler');
jest.mock('./handlers/receive-payment.handler');
jest.mock('./handlers/purchase.handler');
jest.mock('./handlers/bill-payment.handler');
jest.mock('./handlers/vendor.handler');
jest.mock('./handlers/journal-entry.handler');

// Import after mocking
import { dispatch } from './job-dispatcher';
import * as fuelSaleHandler from './handlers/fuel-sale.handler';
import * as receivePaymentHandler from './handlers/receive-payment.handler';
import * as journalEntryHandler from './handlers/journal-entry.handler';

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

  describe('Phase 1 routes (S1..S10)', () => {
    it('sale/create_invoice dispatches to fuel-sale handler (Invoice branch)', async () => {
      const invoicePayload = {
        saleId: 'sale-AR',
        organizationId: 'org-1',
        customerId: 'customer-abc',
        txnDate: '2026-04-19',
        paymentMethod: 'credit_customer',
        lineItems: [{ fuelTypeId: 'fuel-HSD', fuelTypeName: 'HSD', quantity: 40, unitPrice: 260, amount: 10400 }],
        totalAmount: 10400,
      };
      const mockJob = {
        id: 'job-AR', entityType: 'sale', entityId: 'sale-AR',
        jobType: 'create_invoice', organizationId: 'org-1', connectionId: 'conn-1',
        payload: invoicePayload,
      } as QBSyncQueue;

      (fuelSaleHandler.handleFuelSaleCreate as jest.MockedFunction<typeof fuelSaleHandler.handleFuelSaleCreate>)
        .mockResolvedValue({ success: true, qbId: 'QB-INV-1', qbDocNumber: 'INV-1', qbEntity: 'Invoice' });

      const result = await dispatch(mockJob);
      expect(fuelSaleHandler.handleFuelSaleCreate).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({ saleId: 'sale-AR', paymentMethod: 'credit_customer' }),
      );
      expect(result.qbId).toBe('QB-INV-1');
    });

    it('inventory_adjustment/create_journal_entry dispatches to journal-entry handler (S11)', async () => {
      const payload = {
        gainLossId: 'gl-1', organizationId: 'org-1',
        fuelCode: 'HSD', variant: 'loss',
        quantityLitres: 40, costPerLitre: 260, monthLabel: '2026-04',
      };
      const mockJob = {
        id: 'job-JE', entityType: 'inventory_adjustment', entityId: 'gl-1',
        jobType: 'create_journal_entry', organizationId: 'org-1', connectionId: 'conn-1',
        payload,
      } as QBSyncQueue;

      (journalEntryHandler.handleJournalEntryCreate as jest.MockedFunction<typeof journalEntryHandler.handleJournalEntryCreate>)
        .mockResolvedValue({ success: true, qbId: 'QB-JE-1', qbDocNumber: 'DIP-2026-04-HSD-LOSS' });

      const result = await dispatch(mockJob);
      expect(journalEntryHandler.handleJournalEntryCreate).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({ gainLossId: 'gl-1', fuelCode: 'HSD', variant: 'loss' }),
      );
      expect(result.qbId).toBe('QB-JE-1');
    });

    it('customer_payment/create_receive_payment dispatches to receive-payment handler', async () => {
      const payload = {
        receiptId: 'receipt-1',
        organizationId: 'org-1',
        customerId: 'customer-abc',
        qbInvoiceId: 'QB-INV-1',
        paymentDate: '2026-04-19',
        amount: 10400,
        paymentChannel: 'cash',
      };
      const mockJob = {
        id: 'job-RP', entityType: 'customer_payment', entityId: 'receipt-1',
        jobType: 'create_receive_payment', organizationId: 'org-1', connectionId: 'conn-1',
        payload,
      } as QBSyncQueue;

      (receivePaymentHandler.handleReceivePaymentCreate as jest.MockedFunction<typeof receivePaymentHandler.handleReceivePaymentCreate>)
        .mockResolvedValue({ success: true, qbId: 'QB-PAY-1', qbDocNumber: 'PAY-1' });

      const result = await dispatch(mockJob);
      expect(receivePaymentHandler.handleReceivePaymentCreate).toHaveBeenCalledWith(
        mockJob,
        expect.objectContaining({ receiptId: 'receipt-1', qbInvoiceId: 'QB-INV-1' }),
      );
      expect(result.qbId).toBe('QB-PAY-1');
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

    // Regression guard: the legacy `create_backdated_sale` job type silently
    // dead-lettered every finalize because it had no route. daily.service now
    // emits create_sales_receipt / create_invoice instead, and any orphaned
    // queue rows still carrying this legacy type must fail loudly so operators
    // can see them in the admin UI rather than silently retrying forever.
    it('should throw explicit error for legacy backdated_transaction/create_backdated_sale path', async () => {
      const mockJob = {
        id: 'job-legacy',
        entityType: 'backdated_transaction',
        entityId: 'txn-1',
        jobType: 'create_backdated_sale',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        payload: '{}',
      } as QBSyncQueue;

      await expect(dispatch(mockJob)).rejects.toThrow(
        /Unsupported dispatch path: entityType=backdated_transaction, jobType=create_backdated_sale/,
      );
    });
  });
});
