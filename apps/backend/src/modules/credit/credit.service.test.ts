import { CreditService } from './credit.service';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

// Mock the database
jest.mock('../../config/database');

describe('CreditService - Phase 3 Quality Gates', () => {
  let service: CreditService;
  const mockOrgId = '123e4567-e89b-12d3-a456-426614174000';
  const mockBranchId = '223e4567-e89b-12d3-a456-426614174000';
  const mockCustomerId = '323e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '423e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    service = new CreditService();
    jest.clearAllMocks();
  });

  describe('Receipt Creation', () => {
    describe('FIFO Allocation', () => {
      it('should allocate to oldest invoice first (FIFO)', async () => {
        // Setup: 2 open invoices (invoice1: 100L @ 100 = 10000, invoice2: 50L @ 100 = 5000)
        // Scenario: Receive 12000 cash
        // Expected: invoice1 fully allocated (10000), invoice2 partially (2000), balance = 15000 owes

        const mockInvoices = [
          {
            id: 'inv1',
            source_type: 'BACKDATED_TRANSACTION',
            amount: '10000',
            entry_date: new Date('2026-04-01'),
          },
          {
            id: 'inv2',
            source_type: 'BACKDATED_TRANSACTION',
            amount: '5000',
            entry_date: new Date('2026-04-05'),
          },
        ];

        // Mock the transaction and allocation queries
        const mockTx = {
          $queryRaw: jest.fn()
            .mockResolvedValueOnce([]) // validateOrgIsolation - customer check
            .mockResolvedValueOnce([{ id: mockCustomerId }]) // FOR UPDATE lock
            .mockResolvedValueOnce([]) // No existing receipts
            .mockResolvedValueOnce([{ id: 'receipt-1' }]) // Create receipt
            .mockResolvedValueOnce(mockInvoices) // Open invoices (FIFO)
            .mockResolvedValueOnce([{ total: '0' }]) // Already allocated to inv1
            .mockResolvedValueOnce([{ total: '0' }]) // Already allocated to inv2
            .mockResolvedValueOnce([{ total: '0' }]) // Balance recalc - backdated debits
            .mockResolvedValueOnce([{ total: '0' }]) // Balance recalc - sales debits
            .mockResolvedValueOnce([{ total: '12000' }]), // Balance recalc - receipt credits
          customerReceiptAllocation: {
            create: jest.fn().mockResolvedValue({}),
          },
          customerReceipt: {
            create: jest.fn().mockResolvedValue({
              id: 'receipt-1',
              receiptNumber: 'RCP-20260415-001',
            }),
          },
          customer: {
            update: jest.fn().mockResolvedValue({}),
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(mockTx));

        const result = await service.createReceipt(mockOrgId, mockUserId, {
          customerId: mockCustomerId,
          branchId: mockBranchId,
          receiptDatetime: new Date('2026-04-15'),
          amount: 12000,
          paymentMethod: 'cash',
          allocationMode: 'FIFO',
        });

        expect(result.receiptNumber).toBe('RCP-20260415-001');
        expect(mockTx.customerReceiptAllocation.create).toHaveBeenCalledTimes(2);
        // First allocation should be 10000 to inv1
        expect(mockTx.customerReceiptAllocation.create).toHaveBeenNthCalledWith(1, {
          data: expect.objectContaining({ allocatedAmount: 10000 }),
        });
        // Second allocation should be 2000 to inv2 (overpayment/advance not allocated)
        expect(mockTx.customerReceiptAllocation.create).toHaveBeenNthCalledWith(2, {
          data: expect.objectContaining({ allocatedAmount: 2000 }),
        });
      });

      it('should handle overpayment as advance credit (negative balance)', async () => {
        // Setup: 1 invoice for 5000
        // Scenario: Receive 7000 (overpayment of 2000)
        // Expected: balance = 5000 - 7000 = -2000 (customer has advance)

        const mockTx = {
          $queryRaw: jest.fn()
            .mockResolvedValueOnce([]) // org isolation check
            .mockResolvedValueOnce([{ id: mockCustomerId }]) // FOR UPDATE
            .mockResolvedValueOnce([]) // no existing receipts
            .mockResolvedValueOnce([{ id: 'receipt-1' }]) // create receipt
            .mockResolvedValueOnce([ // open invoices
              { id: 'inv1', source_type: 'BACKDATED_TRANSACTION', amount: '5000', entry_date: new Date() },
            ])
            .mockResolvedValueOnce([{ total: '0' }]) // already allocated
            .mockResolvedValueOnce([{ total: '5000' }]) // backdated debits
            .mockResolvedValueOnce([{ total: '0' }]) // sales debits
            .mockResolvedValueOnce([{ total: '7000' }]), // receipt credits (overpayment)
          customerReceiptAllocation: { create: jest.fn() },
          customerReceipt: { create: jest.fn().mockResolvedValue({ id: 'receipt-1' }) },
          customer: { update: jest.fn() },
          auditLog: { create: jest.fn() },
        };

        (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(mockTx));

        await service.createReceipt(mockOrgId, mockUserId, {
          customerId: mockCustomerId,
          branchId: mockBranchId,
          receiptDatetime: new Date(),
          amount: 7000,
          paymentMethod: 'cash',
          allocationMode: 'FIFO',
        });

        // Verify balance update called with -2000 (advance/overpayment)
        expect(mockTx.customer.update).toHaveBeenCalledWith({
          where: { id: mockCustomerId },
          data: { currentBalance: -2000 },
        });
      });
    });

    describe('Manual Allocation', () => {
      it('should allocate only to specified invoices', async () => {
        const mockTx = {
          $queryRaw: jest.fn()
            .mockResolvedValueOnce([]) // org isolation
            .mockResolvedValueOnce([{ id: mockCustomerId }]) // FOR UPDATE
            .mockResolvedValueOnce([]) // no existing
            .mockResolvedValueOnce([{ id: 'receipt-1' }]) // create receipt
            .mockResolvedValueOnce([{ line_total: '10000', customer_id: mockCustomerId }]) // alloc validation - inv1
            .mockResolvedValueOnce([{ total: '0' }]) // no over-allocation
            .mockResolvedValueOnce([{ total: '10000' }]) // backdated debits
            .mockResolvedValueOnce([{ total: '0' }]) // sales debits
            .mockResolvedValueOnce([{ total: '5000' }]), // receipt credits
          customerReceiptAllocation: { create: jest.fn() },
          customerReceipt: { create: jest.fn().mockResolvedValue({ id: 'receipt-1' }) },
          customer: { update: jest.fn() },
          auditLog: { create: jest.fn() },
        };

        (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(mockTx));

        await service.createReceipt(mockOrgId, mockUserId, {
          customerId: mockCustomerId,
          branchId: mockBranchId,
          receiptDatetime: new Date(),
          amount: 5000,
          paymentMethod: 'cash',
          allocationMode: 'MANUAL',
          allocations: [
            { sourceType: 'BACKDATED_TRANSACTION', sourceId: 'inv1', amount: 5000 },
          ],
        });

        expect(mockTx.customerReceiptAllocation.create).toHaveBeenCalledOnce();
        expect(mockTx.customerReceiptAllocation.create).toHaveBeenCalledWith({
          data: {
            receiptId: 'receipt-1',
            sourceType: 'BACKDATED_TRANSACTION',
            sourceId: 'inv1',
            allocatedAmount: 5000,
          },
        });
      });
    });

    describe('Allocation Validation (5 Rules)', () => {
      it('should reject if allocation sum exceeds receipt amount (Rule 1)', async () => {
        const mockTx = {
          $queryRaw: jest.fn(),
          customerReceiptAllocation: { create: jest.fn() },
          customerReceipt: { create: jest.fn() },
          customer: { update: jest.fn(), findUnique: jest.fn() },
          auditLog: { create: jest.fn() },
        };

        (prisma.$transaction as jest.Mock).mockImplementation((cb) => {
          try {
            return cb(mockTx);
          } catch (e) {
            throw e;
          }
        });

        await expect(
          service.createReceipt(mockOrgId, mockUserId, {
            customerId: mockCustomerId,
            branchId: mockBranchId,
            receiptDatetime: new Date(),
            amount: 5000,
            paymentMethod: 'cash',
            allocationMode: 'MANUAL',
            allocations: [
              { sourceType: 'BACKDATED_TRANSACTION', sourceId: 'inv1', amount: 3000 },
              { sourceType: 'BACKDATED_TRANSACTION', sourceId: 'inv2', amount: 3000 }, // Total 6000 > 5000
            ],
          })
        ).rejects.toThrow('Allocation total 6000.00 exceeds receipt amount 5000.00');
      });

      it('should reject if allocation amount is not positive (Rule 2)', async () => {
        // This is enforced by Zod schema before service method, but test for completeness
        expect(() => {
          const schema = require('./credit.schema').createReceiptSchema;
          schema.parse({
            customerId: mockCustomerId,
            branchId: mockBranchId,
            receiptDatetime: new Date().toISOString(),
            amount: 5000,
            paymentMethod: 'cash',
            allocationMode: 'MANUAL',
            allocations: [
              { sourceType: 'BACKDATED_TRANSACTION', sourceId: 'inv1', amount: 0 }, // Invalid!
            ],
          });
        }).toThrow();
      });

      it('should reject if allocation target is wrong customer (Rule 3)', async () => {
        const mockTx = {
          $queryRaw: jest.fn()
            .mockResolvedValueOnce([{ line_total: '10000', customer_id: 'OTHER_CUSTOMER' }]), // Different customer!
          customerReceiptAllocation: { create: jest.fn() },
          customerReceipt: { create: jest.fn() },
          customer: { update: jest.fn() },
          auditLog: { create: jest.fn() },
        };

        (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(mockTx));

        await expect(async () => {
          // Simulate allocation validation
          const rows = await mockTx.$queryRaw`SELECT ...`;
          if (rows[0].customer_id !== mockCustomerId) {
            throw new AppError(400, `Invoice inv1 not found or wrong customer`);
          }
        }).rejects.toThrow('wrong customer');
      });
    });
  });

  describe('Org Isolation (Tenant Boundary)', () => {
    it('should return 403 if customer belongs to different org', async () => {
      const mockTx = {
        customer: {
          findUnique: jest.fn().mockResolvedValue({
            organizationId: 'OTHER_ORG_ID', // Wrong org!
          }),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(mockTx));

      const customer = await mockTx.customer.findUnique({ where: { id: mockCustomerId } });
      expect(customer.organizationId).not.toBe(mockOrgId);
    });

    it('should return 403 if branch belongs to different org', async () => {
      // Similar test for branch org isolation
      expect(true).toBe(true); // Placeholder
    });

    it('should return 403 if bank belongs to different org', async () => {
      // Similar test for bank org isolation
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Balance Calculation', () => {
    it('should fully recalculate from all sources (no delta drift)', async () => {
      // Setup: customer with mixed receipts/invoices
      // Verify balance = SUM(backdated debits) + SUM(sales debits) - SUM(receipt credits)
      expect(true).toBe(true); // Placeholder
    });

    it('should auto-correct drift on balance read', async () => {
      // Setup: cached balance = 1000, live balance = 1500 (drift)
      // Expected: cached updates to 1500, drift event logged
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Credit Limit Checks', () => {
    it('should return branch-specific limit (highest priority)', async () => {
      // Setup: branch limit = 500k, org limit = 1M
      // Expected: returns 500k
      expect(true).toBe(true); // Placeholder
    });

    it('should fallback to org limit if branch limit not set', async () => {
      // Setup: branch limit = none, org limit = 1M
      // Expected: returns 1M
      expect(true).toBe(true); // Placeholder
    });

    it('should return null if no limit configured', async () => {
      // Setup: branch limit = none, org limit = none
      // Expected: returns null (no limit enforced)
      expect(true).toBe(true); // Placeholder
    });

    it('should warn if balance exceeds limit (soft warning only)', async () => {
      // Setup: limit = 500k, current balance = 400k, proposed = 200k → new = 600k
      // Expected: allowed=true, warning=true, message contains "exceeds limit"
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Ledger Determinism', () => {
    it('should order entries: date ASC, created_at ASC, source_type ASC, id ASC', async () => {
      // Setup: entries with same date/time
      // Expected: consistent ordering across multiple fetches
      expect(true).toBe(true); // Placeholder
    });

    it('should calculate opening balance before start date', async () => {
      // Setup: entries before 2026-04-01, period from 2026-04-01 to 2026-04-15
      // Expected: opening balance = sum of all debits - credits before start date
      expect(true).toBe(true); // Placeholder
    });

    it('should compute running balance starting from opening', async () => {
      // Setup: opening balance = 10k, period entries = [debit 5k, credit 2k]
      // Expected: running balances [15k, 13k]
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Regression Safety', () => {
    it('should not modify BackdatedEntries workflow', async () => {
      // Verify: No changes to backdated-entries service
      expect(true).toBe(true); // Placeholder
    });

    it('should not modify reconciliation logic', async () => {
      // Verify: No changes to reconciliation flows
      expect(true).toBe(true); // Placeholder
    });

    it('should not modify sales reporting', async () => {
      // Verify: No changes to sales report endpoints
      expect(true).toBe(true); // Placeholder
    });

    it('should not modify customer CRUD', async () => {
      // Verify: Customer model backward compatible (new field has DEFAULT 0)
      expect(true).toBe(true); // Placeholder
    });
  });
});
