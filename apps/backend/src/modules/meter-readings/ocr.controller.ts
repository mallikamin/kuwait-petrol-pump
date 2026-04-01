/**
 * OCR Controller
 *
 * Handles OCR requests from mobile app.
 * Enforces rate limiting and security.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OCRService } from './ocr.service';
import { OCRRateLimiter, OCRRateLimitError } from './ocr-rate-limiter';

// Validation schema
const ocrRequestSchema = z.object({
  imageBase64: z
    .string()
    .min(100, 'Image data too short')
    .max(10485760, 'Image data too large (max 10MB base64)'), // ~7.5MB actual image
});

export class OCRController {
  /**
   * POST /api/meter-readings/ocr
   * Extract meter reading from image using Claude Vision API
   */
  static processOCR = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      // 1. Authentication check
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // 2. Authorization check (only operators, cashiers, managers)
      if (
        !['ADMIN', 'MANAGER', 'OPERATOR', 'CASHIER'].includes(req.user.role)
      ) {
        return res.status(403).json({
          error: 'Insufficient permissions. Only operators can use OCR.',
        });
      }

      // 3. Validate request body
      const validationResult = ocrRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: validationResult.error.errors,
        });
      }

      const { imageBase64 } = validationResult.data;

      // 4. Check OCR rate limit (50/day per user)
      try {
        const remainingQuota = await OCRRateLimiter.checkQuota(
          req.user.userId
        );
        console.log(
          `[OCR] User ${req.user.userId} has ${remainingQuota} requests remaining`
        );
      } catch (error) {
        if (error instanceof OCRRateLimitError) {
          return res.status(429).json({
            error: error.message,
            remainingRequests: error.remainingRequests,
            resetAt: error.resetAt,
          });
        }
        throw error;
      }

      // 5. Call OCR service
      const result = await OCRService.extractMeterReading(imageBase64);

      // 6. Increment usage counter (only after successful API call)
      await OCRRateLimiter.incrementUsage(req.user.userId);

      // 7. Get updated quota info
      const quotaInfo = await OCRRateLimiter.getRemainingQuota(
        req.user.userId
      );

      // 8. Return result with quota info
      res.json({
        ...result,
        quota: {
          used: quotaInfo.used,
          remaining: quotaInfo.remaining,
          total: quotaInfo.total,
          resetAt: quotaInfo.resetAt,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/meter-readings/ocr/quota
   * Check user's remaining OCR quota
   */
  static getQuota = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const quotaInfo = await OCRRateLimiter.getRemainingQuota(
        req.user.userId
      );

      res.json(quotaInfo);
    } catch (error) {
      next(error);
    }
  };
}
