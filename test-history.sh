#!/bin/bash

# Login
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "operator", "password": "password123"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# Test GET /api/meter-readings
echo "📊 Testing GET /api/meter-readings with snake_case..."
READINGS=$(curl -s -X GET "http://localhost:8001/api/meter-readings?limit=1" \
  -H "Authorization: Bearer $TOKEN")

echo "$READINGS"

if echo "$READINGS" | grep -q 'meter_value'; then
  echo ""
  echo "✅ Returns snake_case format!"
  
  # Extract meter_value to verify it's a number
  METER_VALUE=$(echo "$READINGS" | grep -o '"meter_value":[0-9.]*' | head -1)
  echo "Meter value: $METER_VALUE"
else
  echo ""
  echo "❌ Still using camelCase!"
fi
