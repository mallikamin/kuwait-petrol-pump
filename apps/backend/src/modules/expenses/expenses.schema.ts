import { z } from 'zod';

export const listAccountsQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export const createAccountSchema = z.object({
  label: z.string().min(1).max(128),
  qbAccountName: z.string().max(256).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateAccountSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  qbAccountName: z.string().max(256).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const listEntriesQuerySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional(),
  expenseAccountId: z.string().uuid().optional(),
  includeVoided: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('100'),
  offset: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('0'),
});

export const createEntrySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  expenseAccountId: z.string().uuid(),
  amount: z.number().positive(),
  memo: z.string().max(2000).optional(),
  attachmentPath: z.string().max(500).optional(),
  shiftInstanceId: z.string().uuid().optional(),
});

export const voidEntrySchema = z.object({
  reason: z.string().min(1, 'reason required'),
});
