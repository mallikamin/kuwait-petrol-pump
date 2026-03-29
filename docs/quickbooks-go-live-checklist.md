# QuickBooks Online Integration - Go-Live Checklist

**Last Updated:** 2026-03-29
**Version:** 1.0
**Owner:** Backend Team

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Rollout Order](#rollout-order)
4. [Phase 1: READ_ONLY Mode (Week 1-2)](#phase-1-read_only-mode-week-1-2)
5. [Phase 2: DRY_RUN Mode (Week 3)](#phase-2-dry_run-mode-week-3)
6. [Phase 3: FULL_SYNC Mode (Week 4+)](#phase-3-full_sync-mode-week-4)
7. [Rollback Procedures](#rollback-procedures)
8. [Post-Deployment Smoke Tests](#post-deployment-smoke-tests)
9. [Monitoring & Alerts](#monitoring--alerts)
10. [Emergency Contacts](#emergency-contacts)

---

## Prerequisites

### Infrastructure Requirements

- ✅ Database: PostgreSQL 12+ running with qb_entity_mappings table
- ✅ Redis: Running for queue processor locks
- ✅ Node.js: v16+ (v18 LTS recommended)
- ✅ SSL Certificate: Valid HTTPS certificate for production domain
- ✅ Disk Space: 20GB+ free for logs and backups

### QuickBooks Prerequisites

- ✅ QuickBooks Online account (not Desktop)
- ✅ Production OAuth credentials from Intuit Developer Portal
  - Client ID
  - Client Secret
  - Redirect URI configured: `https://yourproductiondomain.com/api/quickbooks/callback`
- ✅ Company admin access to QuickBooks Online
- ✅ Test QuickBooks company for staging validation

### Team Readiness

- ✅ Admin trained on kill switch activation
- ✅ Backup restoration procedure tested
- ✅ At least 2 team members familiar with rollback procedure
- ✅ 24/7 on-call rotation established

---

## Pre-Deployment Checklist

### 1. Environment Variables (Critical)

**Location:** `.env.production`

```bash
# Verify all QB-related env vars are set:
QUICKBOOKS_CLIENT_ID=<production-client-id>
QUICKBOOKS_CLIENT_SECRET=<production-client-secret>
QUICKBOOKS_REDIRECT_URI=https://kuwaitpos.duckdns.org/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production

# Verify encryption key (32 bytes base64)
QB_TOKEN_ENCRYPTION_KEY=<generate-with-openssl-rand-base64-32>

# Verify Redis
REDIS_URL=redis://localhost:6379

# Verify Database
DATABASE_URL=postgresql://user:pass@host:5432/kuwait_pos
```

**Generate secrets:**

```bash
openssl rand -base64 32  # For QB_TOKEN_ENCRYPTION_KEY
```

### 2. Database Migration

```bash
# Navigate to database package
cd packages/database

# Run migrations (with backup first!)
pg_dump -U postgres kuwait_pos > backup_pre_qb_migration_$(date +%Y%m%d_%H%M%S).sql

# Apply migration
npx prisma migrate deploy

# Verify qb_entity_mappings table exists
psql -U postgres -d kuwait_pos -c "\d qb_entity_mappings"
```

### 3. Build & Test Verification

```bash
# From project root
cd apps/backend

# Clean install
rm -rf node_modules
npm install

# Build (must succeed with 0 errors)
npm run build

# Run all tests (must pass 100%)
npm run test -- --runInBand

# Expected output:
# - 84+ tests passing
# - 0 failures
# - All test suites passed
```

### 4. Entity Mappings Setup

**CRITICAL:** Create mappings BEFORE enabling sync

```bash
# Run preflight check to identify missing mappings
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight

# Example: Create walk-in customer mapping
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "customer",
    "localId": "walk-in",
    "qbId": "1",
    "qbName": "Walk-In Customer"
  }'

# Example: Create payment method mappings
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings/bulk \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": [
      {"entityType": "payment_method", "localId": "cash", "qbId": "1", "qbName": "Cash"},
      {"entityType": "payment_method", "localId": "card", "qbId": "2", "qbName": "Credit Card"}
    ]
  }'

# Example: Create fuel item mappings
# (Get fuel type IDs from database first)
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings/bulk \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": [
      {"entityType": "item", "localId": "FUEL_TYPE_ID_1", "qbId": "10", "qbName": "Petrol"},
      {"entityType": "item", "localId": "FUEL_TYPE_ID_2", "qbId": "11", "qbName": "Diesel"}
    ]
  }'
```

---

## Rollout Order

**NEVER skip phases. Each phase must complete successfully before proceeding.**

| Phase | Mode | Duration | Purpose | Exit Criteria |
|-------|------|----------|---------|---------------|
| 1 | READ_ONLY | 1-2 weeks | Validate OAuth, tokens, infrastructure | No connection errors for 72 hours |
| 2 | DRY_RUN | 1 week | Validate payload building, mappings | 100% of test sales generate valid payloads |
| 3 | FULL_SYNC | Ongoing | Production sync | 95%+ success rate for 1 week |

---

## Phase 1: READ_ONLY Mode (Week 1-2)

**Goal:** Establish stable OAuth connection without any writes to QuickBooks.

### Step 1: Deploy Code

```bash
# From project root
cd apps/backend

# Build
npm run build

# Deploy (example for your deployment method)
# Option A: Docker
docker compose -f docker-compose.prod.yml up -d --build backend

# Option B: PM2
pm2 restart kuwait-pos-backend

# Verify deployment
curl https://kuwaitpos.duckdns.org/api/health
```

### Step 2: Run Preflight Checks

```bash
# Get admin JWT
export ADMIN_JWT="your-admin-jwt-token-here"

# Run preflight
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight

# Expected response:
# {
#   "success": true|false,
#   "overallStatus": "ready"|"warning"|"blocked",
#   "checks": [...],
#   "summary": {...}
# }

# IF overallStatus is "blocked", fix issues before proceeding
# IF overallStatus is "warning", evaluate criticality (may proceed with caution)
# IF overallStatus is "ready", proceed to Step 3
```

### Step 3: Connect QuickBooks OAuth

```bash
# Generate authorization URL
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/oauth/authorize

# Response: { "authorizationUrl": "https://..." }

# Open URL in browser (as admin user)
# Complete Intuit OAuth flow
# Verify successful callback redirect
```

### Step 4: Verify Connection Status

```bash
# Check connection
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/oauth/status

# Expected response:
# {
#   "connected": true,
#   "connection": {
#     "companyName": "Your QB Company",
#     "syncMode": "READ_ONLY",
#     "lastSyncAt": "2026-03-29T...",
#     "tokenExpiresAt": "2026-03-29T..."
#   }
# }
```

### Step 5: Verify Controls

```bash
# Check safety controls
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected response:
# {
#   "success": true,
#   "controls": {
#     "killSwitch": false,
#     "syncMode": "READ_ONLY",
#     "approvalRequired": true
#   },
#   "status": {
#     "connected": true,
#     "canRead": true,
#     "canWrite": false,
#     "canWriteReal": false,
#     "isDryRun": false
#   }
# }
```

### Phase 1 Exit Criteria

✅ OAuth connection stable for 72 hours
✅ No token refresh failures
✅ No 401/403 errors in logs
✅ Preflight checks return "ready" or acceptable "warning"
✅ Team comfortable with kill switch activation

**IF ANY CRITERIA FAIL:** Remain in Phase 1 until resolved.

---

## Phase 2: DRY_RUN Mode (Week 3)

**Goal:** Validate payload building and entity mappings without writing to QuickBooks.

### Step 1: Enable DRY_RUN Mode

```bash
# Enable DRY_RUN
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "DRY_RUN",
    "reason": "Phase 2: Testing payload generation"
  }'

# Verify change
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected: syncMode = "DRY_RUN", isDryRun = true
```

### Step 2: Create Test Sales

```bash
# Create test fuel sale (via POS system or API)
# Sale should process normally in POS
# QB sync queue job created with status "pending"
```

### Step 3: Verify Dry-Run Execution

```bash
# Check audit logs for dry-run entries
tail -f /var/log/kuwait-pos/backend.log | grep "QB_DRY_RUN"

# Expected log lines:
# [QB_DRY_RUN][DECISION] Sale sale-123 processed in dry-run mode | ...
# [QB Audit] CREATE_SALES_RECEIPT_DRY_RUN SUCCESS

# Verify no actual QB API calls were made:
tail -f /var/log/kuwait-pos/backend.log | grep "QB Handler.*FULL_SYNC"
# Should be EMPTY (no FULL_SYNC logs)
```

### Step 4: Validate Payloads

```bash
# Query audit log for dry-run payloads
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/audit/stats?hours=24

# Check for CREATE_SALES_RECEIPT_DRY_RUN operations
# Verify 100% success rate

# Review sample payload structure:
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/audit/failures?hours=24

# IF failures exist, fix mapping/validation errors before Phase 3
```

### Step 5: Test Edge Cases

Create test sales with:
- Walk-in customer (no customer ID)
- Registered customer
- Multiple fuel types in single sale
- Tax inclusion
- Different payment methods (cash, card)

**Verify each generates valid dry-run payload.**

### Phase 2 Exit Criteria

✅ 100 test sales processed in dry-run mode
✅ 0 validation/mapping errors
✅ All entity mappings validated
✅ Payload structure matches QB API spec
✅ No actual QB API calls made (verified in logs)

**IF ANY CRITERIA FAIL:** Fix errors, remain in DRY_RUN until 100% clean.

---

## Phase 3: FULL_SYNC Mode (Week 4+)

**Goal:** Production sync with real QB API writes.

### Step 1: Final Preflight Check

```bash
# Run preflight again
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight

# Must return overallStatus = "ready"
# IF not ready, STOP and fix blockers
```

### Step 2: Backup Production Database

```bash
# CRITICAL: Backup before enabling FULL_SYNC
pg_dump -U postgres kuwait_pos > backup_pre_full_sync_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file exists and is not empty
ls -lh backup_pre_full_sync_*.sql
```

### Step 3: Enable FULL_SYNC Mode

```bash
# Enable FULL_SYNC (WITH CAUTION)
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "FULL_SYNC",
    "reason": "Phase 3: Production cutover approved by [YOUR NAME]"
  }'

# Verify change
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected: syncMode = "FULL_SYNC", canWriteReal = true
```

### Step 4: Monitor Initial Syncs

```bash
# Watch logs for QB writes
tail -f /var/log/kuwait-pos/backend.log | grep "QB_WRITE"

# Expected log lines:
# [QB_WRITE][SUCCESS] Operation CREATE_SALES_RECEIPT succeeded for entity sale-123 | QB ID: 456 | 850ms

# Monitor for errors:
tail -f /var/log/kuwait-pos/backend.log | grep "QB_ERROR"

# IF errors appear:
# 1. Check error category (AUTH_TOKEN, VALIDATION_MAPPING, RATE_LIMIT_TRANSIENT, UNKNOWN_INTERNAL)
# 2. If AUTH_TOKEN or critical: Activate kill switch immediately
# 3. If VALIDATION_MAPPING: Fix and retry
# 4. If RATE_LIMIT_TRANSIENT: Wait for retry
```

### Step 5: Verify in QuickBooks

```bash
# Log into QuickBooks Online
# Navigate to: Sales → Sales Receipts
# Verify recent sales appear with:
#   - Correct customer
#   - Correct line items (fuel types)
#   - Correct payment method
#   - Correct total amount
#   - Private Note: "Kuwait POS Sale #[saleId]"
```

### Phase 3 Ongoing Monitoring

**Daily for first week:**
- ✅ Check sync success rate (target: 95%+)
- ✅ Review error logs (classify by category)
- ✅ Verify QB data accuracy (spot check 10 random sales)
- ✅ Monitor disk space (queue and logs can grow)
- ✅ Check token expiry status

**Weekly after stabilization:**
- ✅ Review audit statistics
- ✅ Check for stale queue jobs
- ✅ Verify backup restoration still works

---

## Rollback Procedures

### Scenario A: Immediate Emergency Stop (Critical Errors)

**Trigger:** Data corruption, mass failures, security breach

**Action:** Activate kill switch

```bash
# EMERGENCY KILL SWITCH
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "killSwitch": true,
    "reason": "EMERGENCY: [describe issue]"
  }'

# Verify all syncs stopped
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected: killSwitch = true, canWrite = false, canRead = false
```

**Post-Kill Switch:**
1. All pending/processing QB jobs cancelled
2. No new jobs accepted
3. System remains operational for POS sales (offline mode)
4. Investigate root cause
5. Fix issue
6. Deactivate kill switch when safe

### Scenario B: Rollback to DRY_RUN (Validation Errors)

**Trigger:** High error rate (>10%), mapping issues, data quality concerns

**Action:** Revert to DRY_RUN

```bash
# Revert to DRY_RUN
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "DRY_RUN",
    "reason": "Rollback: High error rate detected"
  }'

# Verify change
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected: syncMode = "DRY_RUN", isDryRun = true, canWriteReal = false
```

**Post-Rollback:**
1. Fix validation/mapping issues
2. Test in DRY_RUN until clean
3. Re-enable FULL_SYNC when ready

### Scenario C: Rollback to READ_ONLY (Connection Issues)

**Trigger:** OAuth failures, token refresh errors, QB API downtime

**Action:** Revert to READ_ONLY

```bash
# Revert to READ_ONLY
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "READ_ONLY",
    "reason": "Rollback: Connection instability"
  }'
```

### Scenario D: Database Restore (Data Corruption)

**ONLY if data corruption detected in local database**

```bash
# STOP backend
pm2 stop kuwait-pos-backend
# OR
docker compose -f docker-compose.prod.yml stop backend

# Restore database from backup
psql -U postgres -d kuwait_pos < backup_pre_full_sync_YYYYMMDD_HHMMSS.sql

# Verify restore
psql -U postgres -d kuwait_pos -c "SELECT COUNT(*) FROM sales;"

# Restart backend
pm2 start kuwait-pos-backend
# OR
docker compose -f docker-compose.prod.yml up -d backend

# Verify health
curl https://kuwaitpos.duckdns.org/api/health
```

---

## Post-Deployment Smoke Tests

### Test Suite: Post-Deployment Verification

Run after EVERY deployment to production.

#### Test 1: Backend Health

```bash
curl https://kuwaitpos.duckdns.org/api/health

# Expected: 200 OK
# { "status": "healthy", "message": "..." }
```

#### Test 2: QB Connection Status

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/oauth/status

# Expected: 200 OK
# { "connected": true, "connection": {...} }
```

#### Test 3: Preflight Checks

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight

# Expected: 200 OK
# { "success": true, "overallStatus": "ready"|"warning", ... }
```

#### Test 4: Controls Status

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls

# Expected: 200 OK
# Verify syncMode matches expected phase
```

#### Test 5: Entity Mappings

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  "https://kuwaitpos.duckdns.org/api/quickbooks/mappings?entityType=customer"

# Expected: 200 OK
# At least walk-in customer mapping exists
```

#### Test 6: Create Test Sale (DRY_RUN Only)

```bash
# Only if in DRY_RUN mode
# Create test sale via POS
# Verify dry-run log entry appears

tail -f /var/log/kuwait-pos/backend.log | grep "QB_DRY_RUN"
```

#### Test 7: Audit Log Query

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/audit/stats?hours=1

# Expected: 200 OK
# Stats should show recent operations
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

| Metric | Threshold | Action |
|--------|-----------|--------|
| QB Sync Success Rate | < 95% | Investigate failures, may rollback to DRY_RUN |
| Token Refresh Failures | > 0 | Critical: Check OAuth connection |
| Queue Processing Lag | > 1 hour | Check queue processor, Redis connectivity |
| Error Rate (AUTH_TOKEN) | > 0 | Critical: Kill switch + reconnect |
| Error Rate (VALIDATION_MAPPING) | > 5% | Fix mappings, consider DRY_RUN rollback |
| Error Rate (RATE_LIMIT_TRANSIENT) | > 10% | Reduce request rate, increase delays |
| Disk Space | < 10% free | Archive old logs, investigate growth |

### Log Monitoring

**Stable prefixes for grep/monitoring:**

```bash
# Preflight failures
grep "QB_PREFLIGHT.*FAIL" /var/log/kuwait-pos/backend.log

# Dry-run decisions
grep "QB_DRY_RUN.*DECISION" /var/log/kuwait-pos/backend.log

# Control changes
grep "QB_CONTROL.*CHANGE" /var/log/kuwait-pos/backend.log

# Write failures (with category)
grep "QB_WRITE.*FAIL" /var/log/kuwait-pos/backend.log

# Write successes
grep "QB_WRITE.*SUCCESS" /var/log/kuwait-pos/backend.log

# All QB errors (any category)
grep "QB_ERROR" /var/log/kuwait-pos/backend.log
```

### Alert Thresholds (for monitoring system)

```bash
# Example: Prometheus/Grafana alerts
- alert: QBSyncFailureRate
  expr: rate(qb_sync_failures[5m]) > 0.1
  annotations:
    summary: "QB sync failure rate > 10%"
    action: "Check logs, consider DRY_RUN rollback"

- alert: QBAuthFailure
  expr: qb_auth_errors > 0
  annotations:
    summary: "QB authentication failure detected"
    action: "CRITICAL: Activate kill switch + reconnect OAuth"

- alert: QBQueueBacklog
  expr: qb_queue_pending_jobs > 1000
  annotations:
    summary: "QB queue backlog > 1000 jobs"
    action: "Check queue processor health"
```

---

## Emergency Contacts

### On-Call Rotation

| Role | Primary | Backup | Phone | Email |
|------|---------|--------|-------|-------|
| Backend Lead | [NAME] | [NAME] | +XXX | [email] |
| DevOps | [NAME] | [NAME] | +XXX | [email] |
| Product Owner | [NAME] | [NAME] | +XXX | [email] |

### Escalation Path

1. **Level 1:** Backend engineer activates kill switch, notifies team
2. **Level 2:** Backend lead investigates root cause, decides rollback strategy
3. **Level 3:** Product owner decides on production downtime if needed

### External Resources

- **QuickBooks API Status:** https://status.developer.intuit.com/
- **Intuit Developer Support:** https://help.developer.intuit.com/
- **OAuth Troubleshooting:** https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

---

## Appendix: Useful Commands

### Build & Test

```bash
# From apps/backend directory

# Clean install
rm -rf node_modules && npm install

# Build
npm run build

# Run all tests
npm run test -- --runInBand

# Run specific test file
npm run test -- --runInBand routes.test.ts

# Run Task 5 tests only
npm run test -- --runInBand \
  preflight.service.test.ts \
  error-classifier.test.ts \
  routes.test.ts
```

### Database Operations

```bash
# Backup
pg_dump -U postgres kuwait_pos > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
psql -U postgres -d kuwait_pos < backup_YYYYMMDD_HHMMSS.sql

# Check migration status
npx prisma migrate status

# Apply migrations
npx prisma migrate deploy
```

### Log Analysis

```bash
# Last 100 QB-related log lines
tail -n 100 /var/log/kuwait-pos/backend.log | grep "QB"

# Count errors by category today
grep "$(date +%Y-%m-%d)" /var/log/kuwait-pos/backend.log | \
  grep "QB_ERROR" | \
  awk -F'[\\[\\]]' '{print $4}' | \
  sort | uniq -c | sort -nr

# Success rate for last hour
TOTAL=$(grep "QB_WRITE" /var/log/kuwait-pos/backend.log | tail -n 100 | wc -l)
SUCCESS=$(grep "QB_WRITE.*SUCCESS" /var/log/kuwait-pos/backend.log | tail -n 100 | wc -l)
echo "Success Rate: $(echo "scale=2; $SUCCESS * 100 / $TOTAL" | bc)%"
```

---

## Document Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-03-29 | 1.0 | Backend Team | Initial go-live checklist created for Task 5 |

---

**END OF CHECKLIST**

For questions or clarifications, contact Backend Lead or refer to:
- `apps/backend/src/services/quickbooks/` (implementation code)
- `docs/quickbooks-architecture.md` (system design)
- `DEPLOYMENT_SAFETY_PROTOCOL.md` (universal deployment rules)
