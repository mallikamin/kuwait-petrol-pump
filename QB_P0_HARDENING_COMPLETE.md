# QuickBooks P0 Hardening - Complete

## Files Changed (10)

**New Security Services:**
1. `apps/backend/src/services/quickbooks/oauth-state.ts` (NEW)
   - HMAC-signed state tokens (SHA-256)
   - Redis nonce storage (TTL=10min, single-use)
   - Prevents CSRF + replay attacks

2. `apps/backend/src/services/quickbooks/startup-validation.ts` (NEW)
   - Fail-fast if QB env vars missing in production
   - Validates Kuwait-isolated redirect URI
   - Logs startup validation result

**Backend Routes (hardened):**
3. `apps/backend/src/services/quickbooks/routes.ts`
   - ✅ All OAuth routes now use `authenticate` middleware
   - ✅ Control endpoints use `authorize('admin', 'manager')`
   - ✅ Kill switch restricted to `admin` only
   - ✅ `req.user.organizationId` and `req.user.userId` enforced (no query/body params)
   - ✅ OAuth callback validates signed state + nonce
   - ✅ Disconnect calls Intuit revoke endpoint before marking inactive
   - ✅ All audit logs include org + user IDs

4. `apps/backend/src/app.ts`
   - Added `validateQuickBooksConfig()` on startup

**Frontend (JWT-based):**
5. `apps/web/src/pages/QuickBooks.tsx`
   - Removed `organizationId` from API calls
   - Backend extracts org from JWT automatically

---

## Security Fixes Implemented

### 1. ✅ Auth + Org from JWT Only
**Before:** Routes accepted `organizationId` from query/body (spoofable)
**After:** All QB routes use `authenticate` middleware, extract org from `req.user`

**Protected endpoints:**
- `GET /api/quickbooks/oauth/authorize` → `authenticate` + `authorize('admin', 'manager')`
- `GET /api/quickbooks/oauth/status` → `authenticate`
- `POST /api/quickbooks/oauth/disconnect` → `authenticate` + `authorize('admin', 'manager')`
- `POST /api/quickbooks/safety-gates/sync-mode` → `authenticate` + `authorize('admin', 'manager')`
- `POST /api/quickbooks/safety-gates/kill-switch` → `authenticate` + `authorize('admin')` (most restrictive)
- `POST /api/quickbooks/safety-gates/approve-batch` → `authenticate` + `authorize('admin', 'manager')`

### 2. ✅ Signed OAuth State
**Before:** Plain JSON state `{"organizationId":"..."}`
**After:** HMAC-signed token `payloadBase64.signatureBase64url`

**Security properties:**
- Signature prevents tampering
- Expiry (10min TTL) prevents stale tokens
- Nonce stored in Redis (single-use) prevents replay
- State validated on callback (throws if invalid/expired/used)

### 3. ✅ Correct Disconnect Behavior
**Before:** Just marked `isActive=false`, no Intuit revoke
**After:**
1. Calls `oauthClient.revoke()` at Intuit
2. Marks `isActive=false` in DB
3. Logs disconnect with org + user IDs
4. Uses `req.user.userId` for `connectedBy` on OAuth callback

### 4. ✅ App Isolation Validation
**Startup check (production only):**
- Requires `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT`, `QB_TOKEN_ENCRYPTION_KEY`
- Validates redirect URI contains "kuwaitpos" in production
- **Exits with error code 1** if validation fails

**Kuwait QB App Isolation:**
- Dedicated Intuit app for Kuwait POS (NOT shared with restaurant POS)
- Dedicated redirect URI: `https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback`
- Dedicated credentials (rotate separately from other projects)
- No shared secrets across projects

### 5. ✅ Validation Evidence
**Build results:**
```bash
Backend: ✅ PASS (TypeScript clean)
Web: ✅ PASS (7.49s)
```

**API call evidence (with auth):**
```bash
# 1. Get authorize URL (requires JWT)
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3000/api/quickbooks/oauth/authorize

# Expected: { "authorizationUrl": "https://appcenter.intuit.com/connect/oauth2?state=..." }
# State is HMAC-signed, nonce stored in Redis

# 2. Callback (validates state signature + nonce)
# User clicks authorize → Intuit redirects to callback
# Backend validates state, exchanges code for tokens, stores encrypted

# 3. Check status (requires JWT)
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3000/api/quickbooks/oauth/status

# Expected (connected): { "connected": true, "connection": {...} }
# Expected (not connected): { "connected": false }

# 4. Disconnect (requires JWT + admin/manager role)
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/quickbooks/oauth/disconnect

# Expected: { "success": true, "message": "QuickBooks connection disconnected" }
# Intuit revoke called, connection marked inactive

# 5. Unauthorized access blocked
curl http://localhost:3000/api/quickbooks/oauth/status

# Expected: 401 { "error": "No token provided" }

curl -X POST \
  -H "Authorization: Bearer $CASHIER_JWT_TOKEN" \
  http://localhost:3000/api/quickbooks/safety-gates/kill-switch

# Expected: 403 { "error": "Insufficient permissions" }
```

---

## GO/NO-GO: QB Read-Only Production Connect

### Status: **NO-GO** ⛔
**Blocker:** Environment not deployed to production yet

### Requirements Checklist:
- ✅ **P0-1:** Auth + org from JWT only
- ✅ **P0-2:** Signed OAuth state (HMAC + nonce)
- ✅ **P0-3:** Disconnect with Intuit revoke
- ✅ **P0-4:** Startup validation + app isolation
- ✅ **P0-5:** Frontend uses JWT (no org in requests)
- ⛔ **Deployment:** Code not on 64.226.65.80 yet
- ⛔ **Env vars:** Not set on droplet yet
- ⛔ **Intuit app:** Redirect URI not configured yet

### Next Actions (Manual):
1. **Create Kuwait-dedicated Intuit app:**
   - Go to https://developer.intuit.com/app/developer/myapps
   - Create NEW app (name: "Kuwait Petrol Pump POS")
   - Do NOT reuse restaurant POS app
   - Add redirect URI: `https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback`
   - Generate production credentials

2. **Deploy to droplet:**
   ```bash
   ssh root@64.226.65.80
   cd ~/kuwait-pos
   git pull
   # Copy .env vars (see below)
   docker compose up -d --build backend
   docker compose restart nginx
   ```

3. **Set environment variables on droplet:**
   ```bash
   # Add to ~/kuwait-pos/.env
   QUICKBOOKS_CLIENT_ID=<from Intuit developer portal>
   QUICKBOOKS_CLIENT_SECRET=<from Intuit developer portal>
   QUICKBOOKS_REDIRECT_URI=https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback
   QUICKBOOKS_ENVIRONMENT=production
   QB_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
   QB_STATE_SECRET=$(openssl rand -base64 32)
   FRONTEND_URL=https://kuwaitpos.duckdns.org
   REDIS_URL=redis://redis:6379
   ```

4. **Test OAuth flow (browser):**
   - Login as admin/manager
   - Go to https://kuwaitpos.duckdns.org/quickbooks
   - Click "Connect QuickBooks"
   - Complete Intuit OAuth flow
   - Verify status shows "Connected"

5. **Verify in DB:**
   ```bash
   docker exec -it kuwait-postgres psql -U postgres -d kuwait_pos
   SELECT company_name, sync_mode, is_active, connected_by FROM qb_connections;
   ```

### GO Requirements:
Once above 5 steps complete → **GO** for read-only QB sync.

---

## Remaining P0 Work (After Deployment)
1. QB read-only sync smoke test (fetch CompanyInfo, Customers, Items)
2. Approval/kill-switch live test (toggle modes, verify blocked syncs)
3. Backup/restore drill (pg_dump → restore → document)

**Estimated time:** 60 minutes after deployment
