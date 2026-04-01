# UAT Testing Instructions - Kuwait Petrol Pump POS
**Date**: 2026-04-01
**Environment**: Production (64.226.65.80)
**Tester**: Manual UAT

---

## Test Credentials

**Login Details**:
- **Username**: `admin`
- **Password**: `AdminPass123`
- **Role**: Administrator

**URLs**:
- Web App (HTTP): http://64.226.65.80/
- Web App (HTTPS): https://kuwaitpos.duckdns.org/
- API Direct: http://64.226.65.80/api/

---

## Critical Path Tests (Execute in Order)

### ✅ Test 1: Login Flow
**Status**: PASSED (already tested)

**Steps**:
1. Open browser: http://64.226.65.80/
2. Enter username: `admin`
3. Enter password: `AdminPass123`
4. Click "Login"

**Expected**:
- ✅ Redirects to dashboard
- ✅ No console errors
- ✅ User info displayed (name, role)

**If Failed**:
- Check browser console (F12)
- Check network tab for API errors
- Note exact error message

---

### 🔲 Test 2: Dashboard Display

**Steps**:
1. After login, observe dashboard page
2. Check if stats cards load
3. Look for any charts/graphs
4. Verify navigation menu works

**Expected**:
- Dashboard displays without errors
- Key metrics visible (may be zero if no data)
- Navigation sidebar/menu functional
- No blank screens or loading spinners stuck

**What to Check**:
- [ ] Dashboard page loads
- [ ] Stats cards show (today's sales, pending credit, etc.)
- [ ] No JavaScript errors in console
- [ ] Page is responsive (resize browser)

**If Failed**:
- Screenshot the error
- Open browser DevTools (F12) → Console tab
- Copy any red error messages
- Check Network tab for failed API calls

---

### 🔲 Test 3: Manual Meter Reading Submit

**Prerequisites**:
- Need shifts created (may not exist yet)
- Need nozzles configured (may not exist yet)

**Steps**:
1. Navigate to "Meter Readings" or "Fuel Sales"
2. Click "Add Manual Reading" or "Manual Entry"
3. Select shift (dropdown)
4. Select nozzle/pump (dropdown)
5. Enter meter value (e.g., `1234567.89`)
6. Select reading type (opening/closing)
7. Click "Submit"

**Expected**:
- Form submits successfully
- Success message appears
- Reading appears in history/list
- No validation errors (unless expected)

**What to Check**:
- [ ] Shift dropdown loads options
- [ ] Nozzle dropdown loads options
- [ ] Meter value accepts decimal input
- [ ] Submit button works
- [ ] Success confirmation shown

**Common Issues**:
- ⚠️ **No shifts**: Need to create shifts first
  - Go to Admin → Shifts → Create Shift
  - Name: "Morning", Start: 06:00, End: 14:00
- ⚠️ **No nozzles**: Need dispensing units configured
  - Go to Admin → Dispensing Units → Add Unit
  - Then add nozzles to unit

**If Failed**:
- Note which dropdown is empty
- Check if "Admin" or "Setup" menu has shift/nozzle configuration
- Screenshot the error

---

### 🔲 Test 4: OCR Meter Reading Submit

**Prerequisites**:
- OCR endpoint configured (backend has Claude API key)
- Camera/file upload working

**Steps**:
1. Navigate to "Meter Readings" → "OCR Entry"
2. Click "Upload Image" or "Capture Photo"
3. Select a meter reading image (or use test image)
4. Wait for OCR processing
5. Verify extracted value is shown
6. Correct value if needed
7. Click "Submit"

**Expected**:
- Image uploads successfully
- OCR processes (may take 2-5 seconds)
- Extracted value displayed
- Can edit if incorrect
- Submit works

**What to Check**:
- [ ] File upload/camera works
- [ ] OCR processing indicator shown
- [ ] Extracted value appears
- [ ] Value is editable before submit
- [ ] Submit succeeds

**Common Issues**:
- ⚠️ **OCR fails**: Backend may not have Claude API key configured
  - Check backend logs: `ssh root@64.226.65.80 "docker logs kuwaitpos-backend --tail 20"`
  - Look for "Claude API" or "OCR" errors
- ⚠️ **Upload fails**: File size too large (max 5 MB)
- ⚠️ **No OCR menu**: Feature may not be in UI yet

**If Failed**:
- Check if OCR option exists in menu
- Try manual entry instead
- Note exact error message

---

### 🔲 Test 5: History & Reports Visibility

**Steps**:
1. Navigate to "Readings History" or "Reports"
2. Check if submitted readings appear
3. Try date filters (today, this week, custom range)
4. Export report (if available)
5. Check pagination (if many records)

**Expected**:
- History list displays
- Previously submitted readings appear
- Date filters work
- Data is correct (values, timestamps, user)

**What to Check**:
- [ ] History page loads
- [ ] Test readings from Step 3 visible
- [ ] Filters work (date range, shift, nozzle)
- [ ] Data accuracy (correct values, times, user names)
- [ ] Export/print works (if button exists)

**If Failed**:
- Check if any readings show at all
- Try refreshing page
- Check filters are not hiding data

---

## Secondary Tests (After Critical Path)

### 🔲 Test 6: User Management (Admin Only)

**Steps**:
1. Go to "Admin" → "Users"
2. Click "Add User"
3. Enter details:
   - Username: `uat-cashier`
   - Email: `cashier@test.com`
   - Role: Cashier
   - Password: `TestCashier123`
4. Save
5. Logout
6. Login as new user
7. Verify role permissions (cashier can't access admin features)

**Expected**:
- User creation works
- Role-based access enforced
- Cashier sees limited menu

---

### 🔲 Test 7: QuickBooks Integration (If Enabled)

**Steps**:
1. Go to "Admin" → "QuickBooks" or "Integrations"
2. Check connection status
3. If not connected, skip (setup needed)
4. If connected, try "Sync Now" button

**Expected**:
- Status displayed (connected/disconnected)
- Sync button available if connected
- No crashes

---

## Monitoring During Tests

### Backend Logs (Watch in Separate Terminal)
```bash
ssh root@64.226.65.80 "docker logs -f kuwaitpos-backend"
```

**What to Watch For**:
- 🟢 `[info]`: Normal operations
- 🔴 `[error]`: Problems (note these!)
- ⚠️ `500 Internal Server Error`: Critical failures
- ⚠️ `400 Bad Request`: Validation errors
- ⚠️ `401 Unauthorized`: Auth issues

### Container Health
```bash
ssh root@64.226.65.80 "docker ps"
```

**All should show**: `healthy` or `Up X minutes (healthy)`

### Quick Health Check
```bash
curl http://64.226.65.80/api/health
```

**Expected**: `{"status":"ok","timestamp":"...","uptime":...}`

---

## Issue Reporting Template

**If you find a bug, document**:

```
### Issue: [Short Description]

**Test Step**: [Which test above]
**Expected**: [What should happen]
**Actual**: [What actually happened]

**Screenshots**: [Attach if visual issue]

**Browser Console Errors**:
[Paste errors from F12 → Console]

**Network Errors**:
[Paste failed API calls from F12 → Network]

**Backend Logs**:
[Paste relevant error from docker logs]

**Severity**:
- [ ] Critical (blocks core functionality)
- [ ] High (major feature broken)
- [ ] Medium (workaround exists)
- [ ] Low (cosmetic/minor)

**Reproducible**:
- [ ] Yes, every time
- [ ] Sometimes
- [ ] Only once
```

---

## Rollback Decision Criteria

**Rollback immediately if**:
- ❌ Login completely broken for all users
- ❌ Database corruption or data loss
- ❌ Backend crashes repeatedly
- ❌ All API calls return 500 errors

**Create hotfix if**:
- ⚠️ Single feature broken (e.g., OCR)
- ⚠️ UI issue but API works
- ⚠️ Non-critical validation error

**Continue UAT if**:
- ✅ Minor cosmetic issues
- ✅ Missing optional features
- ✅ Performance acceptable

---

## Rollback Command (If Needed)

```bash
ssh root@64.226.65.80 "cd /root/kuwait-pos && \
  docker tag kuwaitpos-backend:backup-20260401-120755 kuwaitpos-backend:latest && \
  docker compose -f docker-compose.prod.yml down && \
  git checkout 12cfe3c && \
  docker compose -f docker-compose.prod.yml up -d"
```

**Rollback time**: < 2 minutes

---

## Post-UAT Checklist

After completing all tests:

- [ ] Document all issues found
- [ ] Categorize by severity
- [ ] Decide: Continue, Hotfix, or Rollback
- [ ] If continuing: Monitor for 1 hour
- [ ] If hotfix needed: Create branch `hotfix/uat-fixes-2026-04-01`
- [ ] If rollback needed: Execute rollback command
- [ ] Update deployment status doc

---

## Success Criteria

**Deployment is GREEN if**:
- ✅ Login works
- ✅ Dashboard displays
- ✅ Can create at least one meter reading (manual OR OCR)
- ✅ History shows submitted data
- ✅ No critical errors in logs
- ✅ System stable for 30+ minutes

**Deployment is YELLOW if**:
- ⚠️ Core flows work but with issues
- ⚠️ Some features broken but workarounds exist
- ⚠️ Needs hotfix but not urgent

**Deployment is RED if**:
- ❌ Login broken
- ❌ Database issues
- ❌ System unstable/crashing
- ❌ Data loss risk

---

## Next Steps After UAT

1. **If GREEN**: Test desktop app next
2. **If YELLOW**: Create hotfix, patch, retest
3. **If RED**: Rollback immediately

---

**Good luck with testing!** 🧪

Report findings and we'll proceed with next steps.
