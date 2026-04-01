/**
 * OCR Service
 *
 * Handles meter reading extraction using Claude Vision API.
 * Centralizes Claude API calls for security and rate limiting.
 */

import axios from 'axios';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

export interface OCRResult {
  extractedValue: number | null;
  confidence: number; // 0-1
  rawText: string;
  error?: string;
}

export class OCRService {
  /**
   * Extract meter reading from base64 image using Claude Vision API
   */
  static async extractMeterReading(imageBase64: string): Promise<OCRResult> {
    // Validate API key is configured
    if (!CLAUDE_API_KEY) {
      console.error('❌ CLAUDE_API_KEY not configured in environment');
      return {
        extractedValue: null,
        confidence: 0,
        rawText: '',
        error: 'OCR service not configured',
      };
    }

    try {
      // Remove data URL prefix if present
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      console.log(`[OCR] Calling Claude API for meter reading extraction...`);

      const response = await axios.post(
        CLAUDE_API_URL,
        {
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: `Extract the numerical meter reading from this fuel dispenser meter.

Rules:
1. Return ONLY the number you see on the meter display
2. Do not include units, decimal points unless clearly visible, or any text
3. If you see multiple numbers, return the main/largest meter reading
4. If the reading is unclear or you cannot find a meter, return "UNCLEAR"

Examples:
- If you see "12345.67" on the meter, return: 12345.67
- If you see "98765" on the meter, return: 98765
- If the image is blurry or no meter visible, return: UNCLEAR

Your response:`,
                },
              ],
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          timeout: 30000, // 30 second timeout
        }
      );

      const rawText = response.data.content[0]?.text?.trim() || '';

      console.log(`[OCR] Claude response: "${rawText}"`);

      // Try to extract number from response
      const numberMatch = rawText.match(/(\d+\.?\d*)/);

      if (rawText.toUpperCase().includes('UNCLEAR') || !numberMatch) {
        console.warn(`[OCR] ⚠️  Could not extract meter reading from image`);
        return {
          extractedValue: null,
          confidence: 0,
          rawText,
          error: 'Could not extract meter reading from image',
        };
      }

      const extractedValue = parseFloat(numberMatch[1]);

      // Calculate confidence based on response clarity
      let confidence = 0.5; // Base confidence

      // Higher confidence if response is just a number
      if (/^\d+\.?\d*$/.test(rawText)) {
        confidence = 0.95;
      } else if (numberMatch) {
        confidence = 0.75;
      }

      console.log(
        `[OCR] ✅ Extracted value: ${extractedValue} (confidence: ${Math.round(confidence * 100)}%)`
      );

      return {
        extractedValue,
        confidence,
        rawText,
      };
    } catch (error) {
      console.error('[OCR] ❌ Error calling Claude API:', error);

      if (axios.isAxiosError(error)) {
        // Handle specific API errors
        if (error.response?.status === 401) {
          return {
            extractedValue: null,
            confidence: 0,
            rawText: '',
            error: 'OCR service authentication failed',
          };
        }

        if (error.response?.status === 429) {
          return {
            extractedValue: null,
            confidence: 0,
            rawText: '',
            error: 'OCR service rate limit exceeded. Please try again later.',
          };
        }

        if (error.response?.status === 413) {
          return {
            extractedValue: null,
            confidence: 0,
            rawText: '',
            error: 'Image too large. Please try a smaller image.',
          };
        }
      }

      return {
        extractedValue: null,
        confidence: 0,
        rawText: '',
        error:
          error instanceof Error
            ? error.message
            : 'OCR processing failed',
      };
    }
  }
}
