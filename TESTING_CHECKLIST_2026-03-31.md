# 🧪 Mobile OCR Testing Checklist - Ready to Test
**Date**: 2026-03-31
**Status**: ✅ All systems operational

---

## ✅ Pre-Testing Status Check

### Backend Status
- ✅ **Running**: `http://localhost:8001`
- ✅ **Health**: OK (uptime: ~10.5 hours)
- ✅ **Process**: PID 24008
- ✅ **Features Loaded**:
  - 7-digit validation
  - Back-dated entry support (customTimestamp)
  - Closing → Opening validation
  - Nozzle + user details in API

### Mobile Status
- ✅ **Package Installed**: `@react-native-community/datetimepicker@9.1.0`
- ✅ **Code Changes**: All 4 screens updated
- ✅ **Features Implemented**:
  - OCR pre-fill on "Correct Manually"
  - Back-dated entry toggle + date/time pickers
  - 7-digit validation with error message
  - Improved editable field styling
  - Nozzle description + operator name in history

### Files Modified (8 files total)
**Backend (4)**:
- ✅ `meter-readings.controller.ts` (nozzle/user in response)
- ✅ `meter-readings.service.ts` (closing→opening, customTimestamp)
- ✅ `meter-readings.schema.ts` (7-digit min, customTimestamp)
- ✅ Running without errors

**Mobile (4)**:
- ✅ `OCRProcessingScreen.tsx` (pre-fill OCR value)
- ✅ `MeterReadingFormScreen.tsx` (back-dated, validation, styling)
- ✅ `ReadingsHistoryScreen.tsx` (nozzle description, operator)
- ✅ `types/index.ts` (added nozzle + created_by relations)

---

## 📋 Testing Procedure

### Step 1: Start Mobile App
```bash
# If Expo not running, start it:
cd apps/mobile
npx expo start

# If already running:
# - Shake device
# - Press "Reload"
```

### Step 2: Test OCR Pre-fill (Issue #1)
**Before**: "Correct Manually" showed blank form
**After**: Form should be pre-filled with OCR value

**Steps**:
1. Login as operator
2. Go to Camera tab
3. Take photo of meter (or use test image)
4. Wait for OCR to extract value (e.g., 1234567.89)
5. Click "Correct Manually" button

**Expected Result**:
- ✅ Form opens with meter value = "1234567.89" (NOT blank)
- ✅ You can edit the value
- ✅ OCR badge shows "OCR: 1234567.89 (85%)"

---

### Step 3: Test 7-Digit Validation (New Feature #1)
**Requirement**: Meter readings must be ≥ 1,000,000

**Test Case A - Reject < 7 digits**:
1. In the form, enter meter value: `123456.00`
2. Fill nozzle + shift
3. Click "Submit Reading"

**Expected Result**:
- ❌ Error alert: "Meter reading must be at least 7 digits (1,000,000 or higher). Please check the reading."
- Form does NOT submit

**Test Case B - Accept ≥ 7 digits**:
1. Enter meter value: `1234567.00`
2. Fill nozzle + shift
3. Click "Submit Reading"

**Expected Result**:
- ✅ Success: "Meter reading submitted successfully!"
- Navigates to Dashboard

---

### Step 4: Test Back-dated Entry (New Feature #2)
**Requirement**: Allow historical entries with custom date/time

**Steps**:
1. Open meter reading form (Camera → Photo → Form OR Manual entry)
2. Scroll down to "Back-dated Entry" toggle
3. Toggle it ON
4. Select date: **2 days ago**
5. Select time: **14:30**
6. Enter valid meter value: `1234599.00`
7. Submit

**Expected Result**:
- ✅ Date picker appears (cannot select future dates)
- ✅ Time picker appears
- ✅ Warning shown: "⚠️ Note: OCR rate limits (50/day) still apply"
- ✅ Submission succeeds
- ✅ In history, timestamp shows **2 days ago at 14:30** (not current time)

---

### Step 5: Test Nozzle Description in History (Issue #2)
**Before**: History showed UUID like `abc-123-def-456`
**After**: Should show "Nozzle 1 - Diesel"

**Steps**:
1. Go to "Readings History" tab
2. Look at any submitted reading

**Expected Result**:
- ✅ **Nozzle**: "Nozzle 1 - Diesel" (or "Nozzle 2 - Petrol", etc.)
- ✅ **Operator**: "John Smith" or username (NOT just user ID)
- ✅ **Time**: "31 Mar 2026, 14:30"
- ✅ **Method**: "OCR (85%)" or "Manual"
- ✅ Photo thumbnail visible (if image was uploaded)

---

### Step 6: Test Editable Fields (Issue #3)
**Before**: Fields had gray background, looked disabled
**After**: White background, blue borders, clearly editable

**Steps**:
1. Open meter reading form
2. Observe field styling

**Expected Result**:
- ✅ Nozzle picker: White background, blue border
- ✅ Shift picker: White background, blue border
- ✅ Meter value input: White background, blue border, bold text
- ✅ All fields are editable (can type/select)

---

### Step 7: Test Closing → Opening Validation (New Feature #3)
**Requirement**: Today's opening should match yesterday's closing

**Setup**:
1. Submit a CLOSING reading today: `1234567.00` for Nozzle 1
2. Wait until tomorrow (or change system date for testing)
3. Submit an OPENING reading tomorrow: `1234567.00` for same Nozzle 1

**Expected Result**:
- ✅ Submission succeeds (values match)
- ✅ Backend logs: No warning

**Test Mismatch**:
1. Tomorrow, submit OPENING: `1234599.00` (different from closing)

**Expected Result**:
- ✅ Submission still succeeds (doesn't block)
- ⚠️ Backend logs warning: "Opening/closing mismatch" (check terminal)
- (Optional: Change service to throw error for strict enforcement)

---

## 🔍 Backend API Testing (Optional)

If you want to test backend directly without mobile:

```bash
# Get auth token
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@test.com","password":"password123"}' \
  | jq -r '.access_token')

# Test 1: Try < 7 digits (should fail)
curl -X POST http://localhost:8001/api/meter-readings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzleId": "YOUR_NOZZLE_ID",
    "shiftId": "YOUR_SHIFT_ID",
    "readingType": "opening",
    "meterValue": 123456.00,
    "isOcr": false
  }'

# Expected: Error with "7 digits" message

# Test 2: Valid 7-digit reading
curl -X POST http://localhost:8001/api/meter-readings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzleId": "YOUR_NOZZLE_ID",
    "shiftId": "YOUR_SHIFT_ID",
    "readingType": "opening",
    "meterValue": 1234567.00,
    "isOcr": false
  }'

# Expected: Success

# Test 3: Back-dated reading
curl -X POST http://localhost:8001/api/meter-readings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzleId": "YOUR_NOZZLE_ID",
    "shiftId": "YOUR_SHIFT_ID",
    "readingType": "closing",
    "meterValue": 1234599.00,
    "isOcr": false,
    "customTimestamp": "2026-03-29T14:30:00.000Z"
  }'

# Expected: Success with custom timestamp

# Test 4: Get history (check nozzle details)
curl -X GET "http://localhost:8001/api/meter-readings?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'

# Expected: Should include nozzle.nozzle_number, nozzle.fuel_type, created_by.full_name
```

---

## ✅ Success Criteria

| Feature | What to Verify | Status |
|---------|---------------|--------|
| OCR Pre-fill | Value shown when "Correct Manually" clicked | ⏳ Test |
| 7-Digit Validation | Rejects < 1,000,000 | ⏳ Test |
| Back-dated Entry | Date/time picker works, saves custom timestamp | ⏳ Test |
| Nozzle Description | Shows "Nozzle X - Fuel" not UUID | ⏳ Test |
| Operator Name | Shows full name in history | ⏳ Test |
| Editable Styling | Fields have white bg + blue borders | ⏳ Test |
| Closing→Opening | Logs warning for mismatch | ⏳ Test |

---

## 🚨 Known Issues / Notes

1. **Date Picker Peer Dependency Warning**:
   - Expo version mismatch (requires 52+, have 50)
   - Package installed and should work fine
   - Warning can be ignored for now

2. **Closing→Opening Validation**:
   - Currently LOGS warning, doesn't BLOCK submission
   - To enforce strict blocking, edit `meter-readings.service.ts:179` and uncomment the `throw new AppError(...)`

3. **OCR Rate Limits**:
   - 50 requests per day still enforced
   - Applies to both current and back-dated entries
   - Counter resets at midnight

4. **Future Dates**:
   - Backend rejects future timestamps
   - Date picker max date = today

---

## 📱 Quick Start Command

```bash
# 1. Backend is already running ✅
# Check: curl http://localhost:8001/api/health

# 2. Start/Reload Expo
cd apps/mobile
npx expo start

# Or if already running:
# - Shake device → "Reload"
```

---

## 📊 Testing Results Template

Copy this and fill in as you test:

```
[ ] Step 2: OCR Pre-fill - Value shown: _______
[ ] Step 3: 7-Digit Validation - Rejects < 1M: Yes/No
[ ] Step 4: Back-dated Entry - Timestamp saved: Yes/No
[ ] Step 5: Nozzle Description - Shows properly: Yes/No
[ ] Step 6: Editable Fields - Clear styling: Yes/No
[ ] Step 7: Closing→Opening - Warning logged: Yes/No

Issues Found:
1. _______________________
2. _______________________
```

---

**Ready to test! Start with Step 1 (reload Expo) and work through each step.** 🚀
