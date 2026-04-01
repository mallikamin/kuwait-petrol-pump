#!/bin/bash

# Test OCR Endpoint - Kuwait Petrol Pump Backend
# Tests the new POST /api/meter-readings/ocr endpoint

BASE_URL="http://localhost:8001/api"

echo "========================================="
echo "  OCR Endpoint Test"
echo "========================================="
echo ""

# Step 1: Login to get JWT token
echo "1. Logging in as operator..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator@test.com",
    "password": "password123"
  }')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed!"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo ""

# Step 2: Check OCR quota
echo "2. Checking OCR quota..."
QUOTA_RESPONSE=$(curl -s -X GET "$BASE_URL/meter-readings/ocr/quota" \
  -H "Authorization: Bearer $TOKEN")

echo "$QUOTA_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$QUOTA_RESPONSE"
echo ""

# Step 3: Test OCR with sample image (small test image)
echo "3. Testing OCR endpoint (with dummy base64 - will fail OCR but test auth/rate-limit)..."

# Create a minimal valid JPEG base64 (1x1 pixel red image)
# This will pass validation but fail OCR extraction (which is expected for this test)
DUMMY_IMAGE="/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA/9k="

OCR_RESPONSE=$(curl -s -X POST "$BASE_URL/meter-readings/ocr" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageBase64\": \"$DUMMY_IMAGE\"
  }")

echo "$OCR_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$OCR_RESPONSE"
echo ""

# Step 4: Check quota again (should be decremented)
echo "4. Checking OCR quota after request..."
QUOTA_RESPONSE_AFTER=$(curl -s -X GET "$BASE_URL/meter-readings/ocr/quota" \
  -H "Authorization: Bearer $TOKEN")

echo "$QUOTA_RESPONSE_AFTER" | python3 -m json.tool 2>/dev/null || echo "$QUOTA_RESPONSE_AFTER"
echo ""

echo "========================================="
echo "✅ Test complete!"
echo ""
echo "Expected behavior:"
echo "  - Login succeeds (JWT token received)"
echo "  - Initial quota: 50 available"
echo "  - OCR request succeeds (auth/rate-limit work)"
echo "  - Quota decremented to 49"
echo ""
echo "Note: OCR extraction will fail with dummy image,"
echo "but endpoint should still return 200 with error field."
echo "========================================="
