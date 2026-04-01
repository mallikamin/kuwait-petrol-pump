import apiClient from './client';
import { OCRResult } from '../types';

/**
 * Extract meter reading from image using backend OCR endpoint
 * Backend handles Claude API calls securely with rate limiting
 */
export const extractMeterReading = async (
  imageBase64: string
): Promise<OCRResult> => {
  try {
    console.log('[OCR] Calling backend OCR endpoint...');

    const response = await apiClient.post<OCRResult & { quota?: { used: number; remaining: number; total: number; resetAt: string } }>(
      '/meter-readings/ocr',
      { imageBase64 }
    );

    const { extractedValue, confidence, rawText, error, quota } = response.data;

    // Log quota info if available
    if (quota) {
      console.log(
        `[OCR] Quota: ${quota.used}/${quota.total} used, ${quota.remaining} remaining`
      );
    }

    if (error) {
      console.warn(`[OCR] ⚠️ ${error}`);
      return {
        extractedValue: null,
        confidence: 0,
        rawText: rawText || '',
        error,
      };
    }

    console.log(
      `[OCR] ✅ Extracted value: ${extractedValue} (confidence: ${Math.round((confidence || 0) * 100)}%)`
    );

    return {
      extractedValue,
      confidence: confidence || 0,
      rawText: rawText || '',
    };
  } catch (error: any) {
    console.error('[OCR] Error:', error);

    // Handle specific error cases
    if (error.response) {
      const { status, data } = error.response;

      // Rate limit error (429)
      if (status === 429) {
        return {
          extractedValue: null,
          confidence: 0,
          rawText: '',
          error: data.error || 'Daily OCR quota exceeded. Please try again tomorrow.',
        };
      }

      // Auth error (401)
      if (status === 401) {
        return {
          extractedValue: null,
          confidence: 0,
          rawText: '',
          error: 'Authentication failed. Please log in again.',
        };
      }

      // Other API errors
      return {
        extractedValue: null,
        confidence: 0,
        rawText: '',
        error: data.error || `OCR service error (${status})`,
      };
    }

    // Network error
    if (error.message?.includes('Network')) {
      return {
        extractedValue: null,
        confidence: 0,
        rawText: '',
        error: 'Network error. Please check your connection.',
      };
    }

    // Generic error
    return {
      extractedValue: null,
      confidence: 0,
      rawText: '',
      error: error instanceof Error ? error.message : 'OCR processing failed',
    };
  }
};
