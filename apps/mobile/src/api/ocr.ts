import axios from 'axios';
import { OCRResult } from '../types';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';

export const extractMeterReading = async (
  imageBase64: string
): Promise<OCRResult> => {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
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
                  data: imageBase64,
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
        timeout: 30000,
      }
    );

    const rawText = response.data.content[0]?.text?.trim() || '';

    // Try to extract number from response
    const numberMatch = rawText.match(/(\d+\.?\d*)/);

    if (rawText.toUpperCase().includes('UNCLEAR') || !numberMatch) {
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

    return {
      extractedValue,
      confidence,
      rawText,
    };
  } catch (error) {
    console.error('OCR Error:', error);

    return {
      extractedValue: null,
      confidence: 0,
      rawText: '',
      error: error instanceof Error ? error.message : 'OCR processing failed',
    };
  }
};
