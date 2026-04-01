#!/bin/bash

# Login
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "operator", "password": "password123"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi

echo "✅ Login successful"

# Test 1: GET /api/meter-readings
echo ""
echo "📊 Testing GET /api/meter-readings..."
READINGS=$(curl -s -X GET "http://localhost:8001/api/meter-readings?limit=10" \
  -H "Authorization: Bearer $TOKEN")

echo "$READINGS" | head -20

if echo "$READINGS" | grep -q '\['; then
  echo "✅ Meter readings endpoint working!"
else
  echo "❌ Meter readings endpoint failed!"
fi

# Test 2: GET /api/dashboard/stats
echo ""
echo "📊 Testing GET /api/dashboard/stats..."
STATS=$(curl -s -X GET "http://localhost:8001/api/dashboard/stats" \
  -H "Authorization: Bearer $TOKEN")

echo "$STATS" | head -20

if echo "$STATS" | grep -q 'total_readings_today'; then
  echo "✅ Dashboard stats endpoint working!"
else
  echo "❌ Dashboard stats endpoint failed!"
fi
