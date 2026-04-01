#!/bin/bash

# Test script for new meter reading features
# Run: bash test-new-features.sh

echo "🧪 Testing New Meter Reading Features..."
echo ""

# Get auth token (replace with real credentials)
echo "1. 🔐 Login..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator@test.com",
    "password": "password123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed. Check credentials."
  exit 1
fi

echo "✅ Logged in successfully"
echo ""

# Test 2: Try submitting reading < 7 digits (should fail)
echo "2. ❌ Testing 7-digit validation (should reject)..."
curl -s -X POST http://localhost:8001/api/meter-readings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "nozzleId": "test-nozzle-id",
    "shiftId": "test-shift-id",
    "readingType": "opening",
    "meterValue": 123456.00,
    "isOcr": false
  }' | jq '.'

echo ""

# Test 3: Submit valid reading with 7 digits
echo "3. ✅ Testing valid 7-digit reading..."
curl -s -X POST http://localhost:8001/api/meter-readings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "nozzleId": "test-nozzle-id",
    "shiftId": "test-shift-id",
    "readingType": "opening",
    "meterValue": 1234567.00,
    "isOcr": false
  }' | jq '.'

echo ""

# Test 4: Submit back-dated reading
echo "4. 📅 Testing back-dated entry..."
YESTERDAY=$(date -d "1 day ago" +"%Y-%m-%dT14:30:00.000Z")
curl -s -X POST http://localhost:8001/api/meter-readings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "nozzleId": "test-nozzle-id",
    "shiftId": "test-shift-id",
    "readingType": "closing",
    "meterValue": 1234599.00,
    "isOcr": false,
    "customTimestamp": "'$YESTERDAY'"
  }' | jq '.'

echo ""

# Test 5: Get readings history (should include nozzle details)
echo "5. 📊 Testing readings history (should show nozzle details)..."
curl -s -X GET "http://localhost:8001/api/meter-readings?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'

echo ""
echo "🎉 All tests completed!"
echo ""
echo "Expected Results:"
echo "  Test 2: Should fail with '7 digits' error"
echo "  Test 3: Should succeed"
echo "  Test 4: Should succeed with custom timestamp"
echo "  Test 5: Should show nozzle.nozzle_number and created_by.full_name"
