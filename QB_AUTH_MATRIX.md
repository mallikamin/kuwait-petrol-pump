# QuickBooks API Authentication Matrix

## Files Changed
- `apps/backend/src/services/quickbooks/routes.ts` (11 endpoints secured)

## Routes Secured
1. `/batches/pending` → Added `authenticate` + `authorize('admin', 'manager')`, removed `organizationId` from query
2. `/replay/replayable` → Added `authenticate` + `authorize('admin', 'manager')`
3. `/replay/batch` → Added `authenticate` + `authorize('admin', 'manager')`
4. `/replay/restore-and-replay` → Added `authenticate` + `authorize('admin', 'manager')`
5. `/replay/history/:batchId` → Added `authenticate` + `authorize('admin', 'manager')`
6. `/replay/cancel` → Added `authenticate` + `authorize('admin', 'manager')`
7. `/circuit-breaker/:connectionId` → Added `authenticate` + `authorize('admin', 'manager')`
8. `/circuit-breaker/reset` → Added `authenticate` + `authorize('admin', 'manager')`
9. `/company-lock/:connectionId` → Added `authenticate` + `authorize('admin', 'manager')`
10. `/audit/stats` → Added `authenticate` + `authorize('admin', 'manager')`
11. `/audit/failures` → Added `authenticate` + `authorize('admin', 'manager')`

## Build/Test Results
```
✅ Backend build: PASS (TypeScript clean)
✅ No compilation errors
✅ All routes type-safe
```

---

## Authentication Matrix

| Route | Method | Unauth (401) | Cashier (403) | Manager (200) | Admin (200) |
|-------|--------|--------------|---------------|---------------|-------------|
| `/health` | GET | ✅ 200 (public) | ✅ 200 (public) | ✅ 200 (public) | ✅ 200 (public) |
| `/oauth/authorize` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/oauth/callback` | GET | ✅ 200 (public)* | ✅ 200 (public)* | ✅ 200 (public)* | ✅ 200 (public)* |
| `/oauth/status` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 |
| `/oauth/disconnect` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/safety-gates` | GET | ❌ 401 | ✅ 200 | ✅ 200 | ✅ 200 |
| `/safety-gates/sync-mode` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/safety-gates/kill-switch` | POST | ❌ 401 | ❌ 403 | ❌ 403 | ✅ 200 |
| `/safety-gates/approve-batch` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/batches/pending` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/replay/replayable` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/replay/batch` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/replay/restore-and-replay` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/replay/history/:batchId` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/replay/cancel` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/circuit-breaker/:connectionId` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/circuit-breaker/reset` | POST | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/company-lock/:connectionId` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/audit/stats` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |
| `/audit/failures` | GET | ❌ 401 | ❌ 403 | ✅ 200 | ✅ 200 |

**Notes:**
- `*` OAuth callback is public by design (Intuit redirects here), but validates signed state token
- `/health` is public for monitoring/load balancers
- Kill switch is **admin-only** (most restrictive)
- All other control endpoints require **admin or manager**
- Status endpoint accessible to **all authenticated users** (read-only)

---

## Summary

**Total endpoints:** 20
**Public:** 2 (`/health`, `/oauth/callback`)
**Authenticated (any role):** 2 (`/oauth/status`, `/safety-gates`)
**Admin + Manager:** 15 (all control/replay/audit operations)
**Admin only:** 1 (`/safety-gates/kill-switch`)

**Security posture:** ✅ PASS
- All sensitive endpoints protected
- Role-based access enforced
- JWT organizationId used (no query/body spoofing)
- No public attack surface except monitoring + OAuth callback
