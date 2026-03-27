import { z } from 'zod';

export const createMeterReadingSchema = z.object({
  nozzleId: z.string().uuid(),
  shiftInstanceId: z.string().uuid(),
  readingType: z.enum(['opening', 'closing']),
  meterValue: z.number().positive(),
  imageUrl: z.string().url().optional(),
  ocrResult: z.number().positive().optional(),
  isManualOverride: z.boolean().default(false),
});

export const verifyReadingSchema = z.object({
  verifiedValue: z.number().positive(),
  isManualOverride: z.boolean(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const nozzleIdParamSchema = z.object({
  nozzleId: z.string().uuid(),
});

export const shiftIdParamSchema = z.object({
  shiftId: z.string().uuid(),
});

// Inferred types - single source of truth
export type CreateMeterReadingInput = z.infer<typeof createMeterReadingSchema>;
export type VerifyReadingInput = z.infer<typeof verifyReadingSchema>;
