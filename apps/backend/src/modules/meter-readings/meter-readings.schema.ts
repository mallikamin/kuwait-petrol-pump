import { z } from 'zod';

export const createMeterReadingSchema = z.object({
  nozzleId: z.string().uuid(),
  shiftInstanceId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  readingType: z.enum(['opening', 'closing']),
  meterValue: z.number().nonnegative({ message: 'Meter reading must be a positive number or zero' }),
  // NOTE: Removed 7-digit minimum for UAT testing - can add back for production if needed
  imageUrl: z.string().optional(), // Relative path or full URL
  imageBase64: z.string().optional(),
  ocrResult: z.number().positive().optional(),
  isOcr: z.boolean().default(false),
  ocrConfidence: z.number().min(0).max(1).optional(),
  isManualOverride: z.boolean().default(false),
  customTimestamp: z.string().datetime().optional(), // For back-dated entries
}).refine(
  (data) => data.shiftInstanceId || data.shiftId,
  { message: 'Either shiftInstanceId or shiftId must be provided' }
);

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
