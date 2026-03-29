# Web P0 Cutover Checklist - PR #2

**Date:** 2026-03-29
**PR:** #2 (Web P0 closeout docs)
**Current Status:** 🟡 Yellow - Manual E2E validation pending
**Target Status:** 🟢 Green - Production-ready

---

## Summary

This PR documents completion of all **code-level** Web P0 gates:
- ✅ Auth guards (ProtectedRoute, JWT interceptor, 401 handling)
- ✅ PreflightPanel full implementation (169 lines, API integrated)
- ✅ QuickBooks component tests (14/14 PASS)
- ✅ Production build (0 TypeScript errors, 954.91 kB bundle)
- ✅ Live backend accessible (kuwaitpos.duckdns.org)

**Remaining Gate:** Manual E2E auth flow validation (5 minutes)

---

## Manual E2E Validation Steps

### Prerequisites
- Access to production backend: https://kuwaitpos.duckdns.org
- Valid user credentials (manager or admin role)
- Web browser (Chrome, Firefox, or Safari)

### Validation Steps (5 minutes)

#### **Step 1: Unauthenticated Access Protection**
1. Open browser in incognito/private mode
2. Navigate to: `https://kuwaitpos.duckdns.org/pos/quickbooks`
3. **Expected:** Redirect to `/login` page
4. **Pass Criteria:** URL changes to `/login`, QuickBooks page NOT accessible

#### **Step 2: Authentication Flow**
1. On login page, enter valid credentials
2. Click "Login" button
3. **Expected:** Successful login → redirect to dashboard
4. **Pass Criteria:**
   - JWT token stored in browser localStorage (`auth-storage`)
   - Dashboard loads successfully
   - No console errors related to auth

#### **Step 3: Authenticated QuickBooks Access**
1. Navigate to: `https://kuwaitpos.duckdns.org/pos/quickbooks`
2. **Expected:** QuickBooks page loads successfully
3. **Pass Criteria:**
   - Page renders without redirect
   - OAuth connection status card visible
   - No 401 errors in Network tab
   - Console shows no auth-related errors

#### **Step 4: Preflight Panel Operation**
1. On QuickBooks page, click "Preflight" tab
2. Click "Run Checks" button
3. **Expected:** Preflight checks execute and display results
4. **Pass Criteria:**
   - API call to `/api/quickbooks/preflight` succeeds (200 or authenticated response)
   - Results table displays check status (pass/warning/fail)
   - Overall status badge shows (ready/warning/blocked)
   - No 401 or auth errors

#### **Step 5: 401 Logout Behavior**
1. Clear JWT token from localStorage:
   - Open DevTools → Application → Local Storage
   - Delete `auth-storage` entry (or clear all)
2. Click any QuickBooks action (e.g., "Run Checks" again)
3. **Expected:** Automatic logout and redirect to `/login`
4. **Pass Criteria:**
   - Network shows 401 response from API
   - Auto-redirect to `/login` occurs
   - Auth state cleared in store

---

## Pass/Fail Criteria

### ✅ **PASS** (All Must Be True)
- [ ] Step 1: Unauthenticated redirect to /login works
- [ ] Step 2: Login flow succeeds, JWT stored in localStorage
- [ ] Step 3: QuickBooks page accessible after auth, no 401 errors
- [ ] Step 4: Preflight panel loads and executes checks successfully
- [ ] Step 5: 401 auto-logout redirects to /login correctly

**If ALL checks PASS:**
- Web P0 status: 🟡 Yellow → 🟢 **Green**
- Web Dashboard: **Production-ready**
- Proceed with QuickBooks production cutover

### ❌ **FAIL** (Any of These)
- [ ] Redirect to /login doesn't work (direct QuickBooks access without auth)
- [ ] Login succeeds but JWT not stored/used correctly
- [ ] QuickBooks page returns 401 despite valid token
- [ ] Preflight panel fails to load or throws auth errors
- [ ] 401 doesn't trigger logout + redirect (stuck on error page)
- [ ] Console shows auth-related JavaScript errors
- [ ] Network tab shows repeated 401 loops

**If ANY check FAILS:**
- Web P0 status: 🟡 Yellow → 🔴 **Red**
- Document exact failure (step #, error message, screenshot)
- Create issue-style failure report with:
  - Reproduction steps
  - Browser console logs
  - Network tab HAR export
  - Remediation plan
- **Do NOT proceed with cutover**

---

## Post-Validation Actions

### If PASS ✅

1. **Update Scorecard** (`docs/ENTERPRISE_GO_LIVE_SCORECARD.md`):
   ```diff
   - Auth-protected flows working end-to-end against live backend:
   -   - ⏸️ Manual E2E validation required (no test credentials per security policy).
   +   - ✅ Manual E2E validation complete (2026-03-29 HH:MM):
   +     - ✅ Unauthenticated redirect verified
   +     - ✅ Login flow and JWT storage confirmed
   +     - ✅ QuickBooks page accessible with auth
   +     - ✅ Preflight panel operational
   +     - ✅ 401 auto-logout verified

   - P0: Yellow (manual E2E validation pending; all code-level gates complete)
   + P0: Green (all gates complete, E2E validated)
   ```

2. **Update/Create Evidence Report**:
   - Add section to `docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md`:
     ```markdown
     ## Manual E2E Validation Results (2026-03-29 HH:MM)

     **Executed by:** [User Name]
     **Environment:** https://kuwaitpos.duckdns.org/pos
     **Browser:** [Chrome/Firefox/Safari] [Version]

     ### Results
     - ✅ Step 1: Unauthenticated redirect - PASS
     - ✅ Step 2: Login flow - PASS (JWT stored correctly)
     - ✅ Step 3: QuickBooks access - PASS (no auth errors)
     - ✅ Step 4: Preflight panel - PASS (checks executed)
     - ✅ Step 5: 401 auto-logout - PASS (redirect works)

     **Verdict:** ✅ PASS - Web P0 Green
     ```

3. **Commit Changes**:
   ```bash
   git checkout -b chore/web-p0-green-2026-03-29
   # (or continue on chore/web-p0-closeout-2026-03-29 if preferred)

   git add docs/ENTERPRISE_GO_LIVE_SCORECARD.md
   git add docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md

   git commit -m "docs(web): advance Web P0 to Green after manual E2E validation PASS

   Manual E2E Validation Results:
   - Unauthenticated redirect: PASS
   - Login flow + JWT storage: PASS
   - QuickBooks auth access: PASS
   - Preflight panel operation: PASS
   - 401 auto-logout: PASS

   Status: Web P0 Yellow -> Green (production-ready)

   Evidence:
   - Manual validation performed 2026-03-29 HH:MM
   - All 5 steps passed with zero auth errors
   - Browser: [Browser] [Version]

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

   git push origin chore/web-p0-green-2026-03-29
   # Open PR #3 (or update PR #2 if continuing same branch)
   ```

4. **Merge PR #2** (or updated PR #3) and proceed with production cutover.

---

### If FAIL ❌

1. **Create Failure Report** (`docs/reports/WEB_P0_E2E_FAILURE_2026-03-29.md`):
   ```markdown
   # Web P0 E2E Validation Failure Report - 2026-03-29

   **Date:** 2026-03-29 HH:MM +05:00
   **Environment:** https://kuwaitpos.duckdns.org/pos
   **Tested By:** [User Name]
   **Browser:** [Browser] [Version]

   ## Executive Summary

   Manual E2E validation FAILED at Step [#]. Auth flow broken.

   ## Failure Details

   ### Failed Step
   - **Step #:** [1-5]
   - **Action:** [What was being tested]
   - **Expected:** [What should have happened]
   - **Actual:** [What actually happened]

   ### Error Messages
   ```
   [Console errors]
   [Network 401/500 responses]
   [Stack traces]
   ```

   ### Screenshots
   [Attach: browser console, network tab, UI state]

   ### Reproduction Steps
   1. [Exact steps to reproduce]
   2. [Include URLs, button clicks, timing]
   3. [Environment details]

   ## Root Cause Hypothesis
   [Likely cause based on error patterns]

   ## Remediation Plan

   ### Immediate (Rollback-Safe)
   1. [Do not merge PR #2]
   2. [Keep Web P0 at Yellow/Red]
   3. [Block production cutover]

   ### Fix Required
   1. [Specific code change needed]
   2. [File: line numbers]
   3. [Test case to add]

   ### Verification After Fix
   1. [Re-run failed step]
   2. [Full E2E re-validation]
   3. [Automated test if possible]

   ## Status
   - Web P0: 🔴 **Red** (E2E validation failed)
   - Production Cutover: **BLOCKED**
   ```

2. **Update Scorecard**:
   ```diff
   - P0: Yellow (manual E2E validation pending; all code-level gates complete)
   + P0: Red (manual E2E validation FAILED at Step [#]; see failure report)

   + Evidence: docs/reports/WEB_P0_E2E_FAILURE_2026-03-29.md
   ```

3. **Commit and Push**:
   ```bash
   git checkout -b fix/web-p0-e2e-failure-2026-03-29
   git add docs/reports/WEB_P0_E2E_FAILURE_2026-03-29.md
   git add docs/ENTERPRISE_GO_LIVE_SCORECARD.md

   git commit -m "docs(web): document Web P0 E2E validation failure

   Failed Step: [#]
   Issue: [Brief description]

   Status: Web P0 Yellow -> Red
   Cutover: BLOCKED

   See: docs/reports/WEB_P0_E2E_FAILURE_2026-03-29.md"

   git push origin fix/web-p0-e2e-failure-2026-03-29
   # Open issue or PR with remediation plan
   ```

4. **Do NOT merge PR #2** until fix is verified.

---

## Quick Reference

| Step | Action | Expected | Time |
|------|--------|----------|------|
| 1 | Access /quickbooks without auth | Redirect to /login | 30s |
| 2 | Login with valid credentials | JWT stored, dashboard loads | 1min |
| 3 | Access /quickbooks with auth | Page loads, no 401 | 1min |
| 4 | Run preflight checks | Results display, no auth errors | 2min |
| 5 | Clear token, trigger API call | Auto-logout, redirect to /login | 30s |

**Total Time:** ~5 minutes

---

## Notes

- **Security Policy:** No credentials stored in code or CI/CD (per CRITICAL RULE #2)
- **Evidence Required:** Manual validation results (PASS/FAIL) with timestamps
- **Scorecard Update:** Objective, evidence-based only (no assumptions)
- **Cutover Decision:** Web P0 Green = ready for production QuickBooks sync

---

## Condition to Move Web P0 Yellow → Green

**Single Condition:**
> All 5 manual E2E validation steps PASS with zero auth-related errors

**If met:**
- Update scorecard: P0 Yellow → Green
- Add timestamped evidence to closeout report
- Merge PR #2 (or follow-up PR #3)
- Proceed with production cutover plan

**If not met:**
- Create failure report with remediation plan
- Update scorecard: P0 Yellow → Red
- Block production cutover
- Fix, re-test, then re-evaluate

---

**Ready for manual validation. Awaiting user confirmation.**
