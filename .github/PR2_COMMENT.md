## 🟡 Web P0 Cutover Checklist - Manual E2E Validation Required

**Current Status:** Yellow (all code-level gates complete)
**Target Status:** Green (production-ready)
**Required Action:** 5-minute manual E2E validation

---

### ✅ What's Already Verified (Code-Level)

- ✅ Auth guards: ProtectedRoute, JWT interceptor, 401 handling
- ✅ PreflightPanel: Full implementation (169 lines, API integrated)
- ✅ Tests: 14/14 PASS
- ✅ Build: 0 errors, 954.91 kB bundle
- ✅ Backend: Accessible (kuwaitpos.duckdns.org returns 200)

**Evidence:** `docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md`

---

### ⏸️ Manual E2E Validation Steps (5 minutes)

**Environment:** https://kuwaitpos.duckdns.org/pos

#### Step 1: Unauthenticated Access Protection (30s)
```
1. Open incognito browser
2. Navigate to: https://kuwaitpos.duckdns.org/pos/quickbooks
3. Expected: Redirect to /login
```
✅ **Pass:** URL redirects to /login, QuickBooks not accessible

#### Step 2: Authentication Flow (1min)
```
1. Enter valid credentials on /login
2. Click "Login"
3. Expected: JWT stored in localStorage, dashboard loads
```
✅ **Pass:** Token in localStorage (`auth-storage`), dashboard renders

#### Step 3: Authenticated QuickBooks Access (1min)
```
1. Navigate to: https://kuwaitpos.duckdns.org/pos/quickbooks
2. Expected: Page loads, OAuth status visible, no 401 errors
```
✅ **Pass:** Page renders, no auth errors in console/network

#### Step 4: Preflight Panel Operation (2min)
```
1. Click "Preflight" tab
2. Click "Run Checks" button
3. Expected: API call succeeds, results display
```
✅ **Pass:** `/api/quickbooks/preflight` returns results, no 401

#### Step 5: 401 Auto-Logout (30s)
```
1. DevTools → Application → Local Storage → Delete "auth-storage"
2. Click "Run Checks" again
3. Expected: 401 response → auto-logout → redirect to /login
```
✅ **Pass:** Auto-logout and redirect work correctly

---

### 🎯 Pass/Fail Criteria

**✅ PASS (All 5 steps succeed):**
- Web P0: Yellow → **Green**
- Web Dashboard: **Production-ready**
- Action: Update scorecard, merge PR, proceed with cutover

**❌ FAIL (Any step fails):**
- Web P0: Yellow → **Red**
- Action: Create failure report, document error, remediate before cutover

---

### 📝 Post-Validation Actions

#### If PASS ✅
1. Update `docs/ENTERPRISE_GO_LIVE_SCORECARD.md`:
   - Change auth E2E status: ⏸️ → ✅ (timestamped)
   - Change P0 status: Yellow → **Green**
2. Add validation results to `docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md`
3. Commit changes:
   ```bash
   git checkout -b chore/web-p0-green-2026-03-29
   git add docs/ENTERPRISE_GO_LIVE_SCORECARD.md docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md
   git commit -m "docs(web): advance Web P0 to Green after manual E2E PASS"
   git push origin chore/web-p0-green-2026-03-29
   ```
4. **Merge PR #2** and proceed with production cutover

#### If FAIL ❌
1. Create `docs/reports/WEB_P0_E2E_FAILURE_2026-03-29.md`:
   - Document failed step, error logs, screenshots
   - Root cause hypothesis
   - Remediation plan
2. Update scorecard: P0 Yellow → **Red**
3. **Do NOT merge PR #2**
4. Fix issue, re-test, re-evaluate

---

### 🔑 Condition to Move Web P0 Yellow → Green

**Single Condition:**
> All 5 manual E2E validation steps PASS with zero auth-related errors

**Time Required:** ~5 minutes
**Blocker:** None (awaiting user execution only)

---

**Full checklist:** `.github/PR2_CUTOVER_CHECKLIST.md`
**Ready for validation.** Please execute the 5 steps and report PASS/FAIL.
