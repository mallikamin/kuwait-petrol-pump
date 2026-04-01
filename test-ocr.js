const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Configuration
const IMAGE_PATH = 'C:/ST/Sitara Infotech/Kuwait Petrol Pump/BPO/Nozzle Pictures/WhatsApp Image 2026-03-26 at 5.39.18 PM (1).jpeg';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

if (!CLAUDE_API_KEY) {
  console.error('❌ ERROR: CLAUDE_API_KEY environment variable is required');
  console.error('Set it with: export CLAUDE_API_KEY=your-key-here');
  process.exit(1);
}
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

async function testOCR() {
  console.log('🔍 Testing OCR with Claude Vision API...\n');
  console.log(`📷 Image: ${path.basename(IMAGE_PATH)}`);
  console.log(`🤖 Model: ${CLAUDE_MODEL}\n`);

  try {
    // Step 1: Read and convert image to base64
    console.log('⏳ Converting image to base64...');
    const imageBuffer = fs.readFileSync(IMAGE_PATH);
    const base64Image = imageBuffer.toString('base64');
    console.log(`✅ Base64 length: ${base64Image.length} characters\n`);

    // Step 2: Call Claude Vision API
    console.log('⏳ Calling Claude Vision API...');
    const startTime = Date.now();

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
                  data: base64Image,
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

    const duration = Date.now() - startTime;
    console.log(`✅ API responded in ${duration}ms\n`);

    // Step 3: Extract the response
    const rawText = response.data.content[0]?.text?.trim() || '';
    console.log('📝 Raw Claude Response:');
    console.log(`   "${rawText}"\n`);

    // Step 4: Parse the number (same logic as mobile app)
    const numberMatch = rawText.match(/(\d+\.?\d*)/);

    if (rawText.toUpperCase().includes('UNCLEAR') || !numberMatch) {
      console.log('❌ Result: Could not extract meter reading');
      console.log('   Confidence: 0%');
      return {
        extractedValue: null,
        confidence: 0,
        rawText,
        error: 'Could not extract meter reading from image',
      };
    }

    const extractedValue = parseFloat(numberMatch[1]);

    // Calculate confidence (same logic as mobile app)
    let confidence = 0.5;
    if (/^\d+\.?\d*$/.test(rawText)) {
      confidence = 0.95;
    } else if (numberMatch) {
      confidence = 0.75;
    }

    console.log('✅ Extraction Successful!');
    console.log(`   Extracted Value: ${extractedValue}`);
    console.log(`   Confidence: ${(confidence * 100).toFixed(0)}%`);
    console.log(`   Confidence Level: ${confidence >= 0.8 ? 'High' : confidence >= 0.5 ? 'Medium' : 'Low'}\n`);

    return {
      extractedValue,
      confidence,
      rawText,
    };

  } catch (error) {
    console.error('❌ OCR Error:', error.response?.data || error.message);

    if (error.response) {
      console.error('\n📋 Response Details:');
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Status Text: ${error.response.statusText}`);
      if (error.response.data) {
        console.error(`   Error Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }

    return {
      extractedValue: null,
      confidence: 0,
      rawText: '',
      error: error.message,
    };
  }
}

// Run the test
testOCR().then(result => {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Final Result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('='.repeat(60));
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
