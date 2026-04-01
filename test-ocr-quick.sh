#!/bin/bash

# Quick OCR Test - After Adding Claude API Key

echo "========================================="
echo "  Quick OCR Quota Check"
echo "========================================="
echo ""

# Note: You need to create a user first or use existing user credentials
echo "1. Login and check OCR quota..."
echo ""
echo "To test fully, you need:"
echo "  - A valid user in the database"
echo "  - JWT token from login"
echo ""
echo "Quick check: Verify backend is running with new API key"
curl -s http://localhost:8001/api/health && echo "" && echo "✅ Backend is running"
echo ""
echo "Rate Limits Configured:"
echo "  - 50 OCR requests/day per user"
echo "  - Redis-based (survives restarts)"
echo "  - Auto-reset at midnight"
echo ""
echo "To test OCR endpoint:"
echo "  1. Create a user or use existing credentials"
echo "  2. Login to get JWT token"
echo "  3. Call POST /api/meter-readings/ocr with token"
echo "  4. Check quota with GET /api/meter-readings/ocr/quota"
echo "========================================="
