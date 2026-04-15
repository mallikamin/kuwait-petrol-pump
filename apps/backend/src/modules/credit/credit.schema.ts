import { z } from 'zod';

// ============================================================
// Receipt Schemas
// ============================================================

export const createReceiptSchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  receiptDatetime: z.string().datetime().transform((str) => new Date(str)),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'cheque', 'bank_transfer', 'online']),
  bankId: z.string().uuid().optional(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
  attachmentPath: z.string().max(500).optional(),
  allocationMode: z.enum(['FIFO', 'MANUAL']).default('FIFO'),
  allocations: z
    .array(
      z.object({
        sourceType: z.enum(['BACKDATED_TRANSACTION', 'SALE']),
        sourceId: z.string().uuid(),
        amount: z.number().positive(),
      })
    )
    .optional(),
}).strict();

export const updateReceiptSchema = z.object({
  branchId: z.string().uuid().optional(),
  receiptDatetime: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  amount: z.number().positive().optional(),
  paymentMethod: z.enum(['cash', 'cheque', 'bank_transfer', 'online']).optional(),
  bankId: z.string().uuid().nullable().optional(),
  referenceNumber: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  attachmentPath: z.string().max(500).nullable().optional(),
  allocationMode: z.enum(['FIFO', 'MANUAL']).optional(),
  allocations: z
    .array(
      z.object({
        sourceType: z.enum(['BACKDATED_TRANSACTION', 'SALE']),
        sourceId: z.string().uuid(),
        amount: z.number().positive(),
      })
    )
    .optional(),
}).strict();

export const getReceiptsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  startDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  endDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('100'),
  offset: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('0'),
});

// ============================================================
// Ledger Schemas
// ============================================================

export const getCustomerLedgerQuerySchema = z.object({
  startDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  endDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('100'),
  offset: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('0'),
  vehicleNumber: z.string().optional(),
  entryType: z.enum(['INVOICE', 'RECEIPT']).optional(),
  branchId: z.string().uuid().optional(),
});

export const checkCreditLimitQuerySchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  amount: z
    .string()
    .transform((val) => parseFloat(val))
    .refine((val) => val > 0, { message: 'Amount must be positive' }),
});

// ============================================================
// Report Schemas
// ============================================================

export const getPartyPositionQuerySchema = z.object({
  hideZeroBalance: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  customerId: z.string().uuid().optional(),
});

export const exportReportQuerySchema = z.object({
  format: z.enum(['pdf', 'csv', 'excel']),
  customerId: z.string().uuid().optional(),
  startDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  endDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .optional(),
  hideZeroBalance: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

// ============================================================
// Branch Limit Schemas
// ============================================================

export const setBranchLimitSchema = z.object({
  branchId: z.string().uuid(),
  creditLimit: z.number().nonnegative(),
  creditDays: z.number().int().positive().optional(),
});
