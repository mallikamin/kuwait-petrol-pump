# Meter Readings API Test Plan

## Test Scenario: Apr 3, 2026 (24 Readings Entered)

### Expected Production Data:
- **6 nozzles** × **2 shifts** × **2 reading types** = **24 readings**
- Day Shift (Shift #1): 6 nozzles × opening + closing = 12 readings
- Night Shift (Shift #2): 6 nozzles × opening + closing = 12 readings

### Database Verification:
```sql
SELECT COUNT(*), DATE(recorded_at) as date
FROM meter_readings
WHERE DATE(recorded_at) = '2026-04-03'
GROUP BY DATE(recorded_at);
-- Expected: 24 rows
```

### API Test Workflow:

#### 1. Login to get token
```bash
# Get auth token
TOKEN=$(curl -s -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "***"
  }' | jq -r '.data.accessToken')

echo "Token: $TOKEN"
```

#### 2. Get branch ID
```bash
BRANCH_ID=$(curl -s "https://kuwaitpos.duckdns.org/api/branches" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')

echo "Branch ID: $BRANCH_ID"
```

#### 3. Test Apr 3 (all entered)
```bash
curl -s "https://kuwaitpos.duckdns.org/api/backdated-meter-readings/daily?branchId=$BRANCH_ID&businessDate=2026-04-03" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

**Expected Response Structure:**
```json
{
  "success": true,
  "data": {
    "businessDate": "2026-04-03",
    "branchId": "...",
    "shifts": [
      {
        "shiftId": "...",
        "shiftName": "Day Shift",
        "shiftNumber": 1,
        "startTime": "06:00:00",
        "endTime": "18:00:00",
        "nozzles": [
          {
            "nozzleId": "...",
            "nozzleName": "D1N1-HSD",
            "fuelType": "HSD",
            "fuelTypeName": "High Speed Diesel",
            "opening": {
              "value": 1000000.00,
              "status": "entered",
              "shiftInstanceId": "...",
              "recordedAt": "2026-04-03T..."
            },
            "closing": {
              "value": 1000500.00,
              "status": "entered",
              "shiftInstanceId": "...",
              "recordedAt": "2026-04-03T..."
            }
          }
          // ... 5 more nozzles
        ]
      },
      {
        "shiftId": "...",
        "shiftName": "Night Shift",
        "shiftNumber": 2,
        "nozzles": [
          {
            "nozzleId": "...",
            "nozzleName": "D1N1-HSD",
            "opening": {
              "value": 1000500.00,
              "status": "entered" // or "derived_from_prev_shift" if auto-chained
            },
            "closing": {
              "value": 1000950.00,
              "status": "entered"
            }
          }
          // ... 5 more nozzles
        ]
      }
    ],
    "summary": {
      "totalNozzles": 6,
      "totalReadingsExpected": 24,
      "totalReadingsEntered": 24,
      "totalReadingsDerived": 0,
      "totalReadingsMissing": 0,
      "completionPercent": 100
    }
  }
}
```

#### 4. Test Apr 2 (derived values)
```bash
curl -s "https://kuwaitpos.duckdns.org/api/backdated-meter-readings/daily?branchId=$BRANCH_ID&businessDate=2026-04-02" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

**Expected Behavior:**
- If Apr 2 has NO data, Night Shift closing should derive from Apr 3 Day Shift opening
- Status should be `"derived_from_next_shift"`
- If Apr 2 has partial data, mix of `entered` and `derived_from_*` statuses

#### 5. Validation Checks
```bash
# Extract summary stats
curl -s "https://kuwaitpos.duckdns.org/api/backdated-meter-readings/daily?branchId=$BRANCH_ID&businessDate=2026-04-03" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary'

# Expected output:
# {
#   "totalNozzles": 6,
#   "totalReadingsExpected": 24,
#   "totalReadingsEntered": 24,
#   "totalReadingsDerived": 0,
#   "totalReadingsMissing": 0,
#   "completionPercent": 100
# }

# Count nozzles per shift
curl -s "https://kuwaitpos.duckdns.org/api/backdated-meter-readings/daily?branchId=$BRANCH_ID&businessDate=2026-04-03" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.shifts[] | {shift: .shiftName, nozzleCount: (.nozzles | length)}'

# Expected output:
# {
#   "shift": "Day Shift",
#   "nozzleCount": 6
# }
# {
#   "shift": "Night Shift",
#   "nozzleCount": 6
# }
```

## Success Criteria (Per User Requirements):

✅ **Apr 3 returns all 24 points as "entered"**
- 6 nozzles × 2 shifts × 2 types = 24 readings
- All status = "entered"
- Summary: 24 entered, 0 derived, 0 missing

✅ **Apr 2 returns derived values with source markers**
- Night Shift closing derives from Apr 3 Day Shift opening
- Status = "derived_from_next_shift"
- Summary shows count of derived readings

✅ **Explicit entries override derived**
- If both explicit and derived exist, explicit wins
- Status = "entered" takes precedence

## Proof of Bidirectional Sync (Phase 2):
1. Create reading via Meter Readings module → verify visible in this API
2. Create reading via Backdated Logs → verify visible in Meter Readings API
3. Both should return same reading ID, value, timestamp
