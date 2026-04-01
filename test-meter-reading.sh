#!/bin/bash
# Test meter reading submission

# Login as operator
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator",
    "password": "password123"
  }')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"

# Get first nozzle and shift from DB
NOZZLE_ID="9dd85167-12f1-413c-8a48-f8612dfe2370"
SHIFT_ID="38191e48-057b-4988-a2d2-d320aa4866c3"

# Submit meter reading
echo "📊 Submitting meter reading..."
SUBMIT_RESPONSE=$(curl -s -X POST http://localhost:8001/api/meter-readings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"nozzleId\": \"$NOZZLE_ID\",
    \"shiftId\": \"$SHIFT_ID\",
    \"readingType\": \"opening\",
    \"meterValue\": 784331,
    \"isOcr\": false,
    \"isManualOverride\": false
  }")

echo "$SUBMIT_RESPONSE"

if echo "$SUBMIT_RESPONSE" | grep -q '"meterReading"'; then
  echo ""
  echo "✅ SUCCESS! Meter reading created!"
else
  echo ""
  echo "❌ FAILED!"
  exit 1
fi
