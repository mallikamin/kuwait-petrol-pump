# Production Deployment Sequence
**Kuwait Petrol Pump POS - Sprint 1 Deployment**

**Date**: 2026-03-28
**Target host**: use `DROPLET_IP` from `.env.server` (local-only; do not commit)
**Status**: CONDITIONAL (run verification steps first)
**Risk Level**: UNKNOWN until verification evidence is captured

---

## Pre-Deployment Verification

**Local checks** (run BEFORE SSHing to server):

```bash
# Verify build is clean
cd C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump
npm.cmd run build -w @petrol-pump/backend
# Expected: "tsc" completes with zero errors

# Verify tests pass
npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
# Expected: 11 passed, 11 total

# Verify migration exists
ls packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/
# Expected: migration.sql file present

# Verify git is clean
git status
# Expected: Only tracked changes are the ones you committed
```

Only proceed if ALL local checks pass.

---

## Phase 1: Server Access & Pre-Deployment Backup

```bash
# 1.1 - SSH to server
ssh root@<YOUR_DROPLET_IP>

# 1.2 - Navigate to project
cd /root/kuwait-pos

# 1.3 - Check current state
docker compose -f docker-compose.prod.yml ps
# Expected: All services should be "Up" or not yet created

# 1.4 - Create backup directory (if doesn't exist)
mkdir -p /root/backups

# 1.5 - Backup current database (MANDATORY)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
echo "Creating backup at: /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz"

docker exec kuwaitpos-postgres pg_dump -U postgres kuwait_pos \
  | gzip > /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz

# 1.6 - Verify backup created successfully
ls -lh /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz
# Expected: Non-zero file size (at least 1KB)

# 1.7 - Test backup integrity
gunzip -t /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz
echo "Backup integrity: $?"
# Expected: Exit code 0 (success)

# 1.8 - Backup .env file
cp .env .env.backup-$TIMESTAMP
ls -lh .env.backup-$TIMESTAMP
# Expected: File exists with same size as .env
```

**✅ CHECKPOINT**: Backups verified before proceeding.

---

## Phase 2: Code Update

```bash
# 2.1 - Fetch latest code
git fetch origin master

# 2.2 - Show what will change
git log HEAD..origin/master --oneline
# Review commits to be pulled

# 2.3 - Pull latest code
git pull origin master

# 2.4 - Verify migration file was pulled
ls -lh packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql
# Expected: File exists (~2-3KB)

# 2.5 - Check migration SQL content (optional review)
cat packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql
# Expected: DROP INDEX + CREATE UNIQUE INDEX commands
```

**✅ CHECKPOINT**: Code updated, migration file present.

---

## Phase 3: Build & Deploy

```bash
# 3.1 - Stop backend (keep DB running)
docker compose -f docker-compose.prod.yml stop backend

# 3.2 - Build new backend image
docker compose -f docker-compose.prod.yml build backend

# 3.3 - Start all services (backend will come up with new code)
docker compose -f docker-compose.prod.yml up -d

# 3.4 - Wait for services to stabilize (30 seconds)
sleep 30

# 3.5 - Check service status
docker compose -f docker-compose.prod.yml ps
# Expected: All services "Up" (healthy)

# 3.6 - Check backend logs for startup errors
docker compose -f docker-compose.prod.yml logs backend | tail -50
# Expected: No ERROR or FATAL messages, should see "Server started on port 3000"
```

**✅ CHECKPOINT**: Services running, no startup errors.

---

## Phase 4: Database Migration

```bash
# 4.1 - Apply Prisma migration
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Expected output:
# "1 migration found in prisma/migrations"
# "The following migration(s) have been applied:"
# "20260328063646_tenant_scoped_uniqueness"

# 4.2 - Verify migration applied
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status

# Expected: "Database schema is up to date!"

# 4.3 - Check PostgreSQL indexes were created
docker exec kuwaitpos-postgres psql -U postgres kuwait_pos -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'User' AND indexname LIKE '%organizationId%';"

# Expected: Shows unique index like "User_username_organizationId_key"
```

**✅ CHECKPOINT**: Migration applied, schema updated.

---

## Phase 5: Health & Smoke Tests

### 5.1 - Basic Health Check

```bash
# Test API is responding
curl -sS https://kuwaitpos.duckdns.org/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

### 5.2 - Authentication Test

```bash
# Login with valid credentials (REPLACE with real username/password)
TOKEN=$(curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
  | jq -r '.access_token')

# Verify token received
echo "Token (first 40 chars): ${TOKEN:0:40}"
# Expected: JWT string starting with "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# If token is empty or "null", check error:
curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}'
# Expected: {"access_token":"...","user":{...}}
```

### 5.3 - Sync Status Test

```bash
# Test authenticated sync endpoint
curl -sS https://kuwaitpos.duckdns.org/api/sync/status \
  -H "Authorization: Bearer $TOKEN"

# Expected: {"pending":0,"failed":0,"completed":...}
```

### 5.4 - Idempotency Test (Critical for offline sync)

```bash
# Create test payload (REPLACE UUIDs with real ones from your database)
cat > /tmp/sync-test-payload.json <<'JSON'
{
  "deviceId": "deploy-test-device-1",
  "sales": [
    {
      "offlineQueueId": "deploy-test-001",
      "branchId": "REPLACE_WITH_REAL_BRANCH_UUID",
      "shiftInstanceId": "REPLACE_WITH_REAL_SHIFT_UUID",
      "saleDate": "2026-03-28T12:00:00Z",
      "saleType": "fuel",
      "totalAmount": 1000,
      "taxAmount": 0,
      "discountAmount": 0,
      "paymentMethod": "cash",
      "cashierId": "REPLACE_WITH_REAL_USER_UUID",
      "fuelSales": []
    }
  ]
}
JSON

# First submission (should create sale)
echo "=== First submission ==="
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/sync-test-payload.json | jq

# Expected: {"synced": {"sales":1}, "failed": {"sales":0}}

# Second submission (should be idempotent - no duplicate)
echo "=== Second submission (idempotency check) ==="
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/sync-test-payload.json | jq

# Expected: {"synced": {"sales":0}, "failed": {"sales":0}}
# OR: {"synced": {"sales":1}, "failed": {"sales":0}} (if already existed)

# Verify no duplicate sales in database
docker exec kuwaitpos-postgres psql -U postgres kuwait_pos -c \
  "SELECT COUNT(*) FROM \"Sale\" WHERE \"offlineQueueId\" = 'deploy-test-001';"

# Expected: count = 1 (not 2)
```

**✅ CHECKPOINT**: All smoke tests passing.

---

## Phase 6: Post-Deployment Monitoring

```bash
# 6.1 - Watch logs for any errors (30 seconds)
echo "Watching logs for 30 seconds... (Ctrl+C to stop early)"
timeout 30s docker compose -f docker-compose.prod.yml logs -f backend \
  || docker compose -f docker-compose.prod.yml logs backend | tail -100

# Look for:
# ✅ No ERROR or FATAL messages
# ✅ No Prisma query errors
# ✅ No "Unique constraint failed" errors

# 6.2 - Check resource usage
docker stats --no-stream

# Expected:
# - Backend: <200MB RAM
# - PostgreSQL: <300MB RAM
# - Redis: <50MB RAM
# Total: <600MB (well under 4GB limit)

# 6.3 - Verify SSL certificate
curl -v https://kuwaitpos.duckdns.org/api/health 2>&1 | grep "SSL certificate verify"
# Expected: "SSL certificate verify ok"

# 6.4 - Final service status
docker compose -f docker-compose.prod.yml ps
# Expected: All services "Up" with uptime increasing
```

**✅ DEPLOYMENT COMPLETE** if all checks pass.

---

## Post-Deployment Documentation

```bash
# Record deployment in log
cat >> /root/kuwait-pos-deployment-log.txt <<EOF
---
Deployment Date: $(date +"%Y-%m-%d %H:%M:%S %Z")
Deployed By: root
Git Commit: $(git rev-parse HEAD)
Migration Applied: 20260328063646_tenant_scoped_uniqueness
Backup Location: /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz
Status: SUCCESS
Tests: ✅ Health, ✅ Auth, ✅ Sync, ✅ Idempotency
Notes: Sprint 1 - Multi-tenant sync implementation
---
EOF

cat /root/kuwait-pos-deployment-log.txt | tail -10
```

---

## Rollback Procedure (If Something Goes Wrong)

### Quick Rollback (< 5 minutes)

```bash
# 1 - Stop backend immediately
docker compose -f docker-compose.prod.yml stop backend

# 2 - Restore database from backup
ROLLBACK_FILE="/root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz"
echo "Rolling back from: $ROLLBACK_FILE"

# Drop current database (DESTRUCTIVE - only do in emergency)
docker exec kuwaitpos-postgres psql -U postgres -c "DROP DATABASE kuwait_pos;"
docker exec kuwaitpos-postgres psql -U postgres -c "CREATE DATABASE kuwait_pos;"

# Restore backup
gunzip -c "$ROLLBACK_FILE" | docker exec -i kuwaitpos-postgres psql -U postgres kuwait_pos

# 3 - Revert code to previous commit
git log --oneline -5  # Find previous commit hash
git reset --hard <PREVIOUS_COMMIT_HASH>

# 4 - Rebuild and restart
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d

# 5 - Verify rollback
curl -sS https://kuwaitpos.duckdns.org/api/health
docker compose -f docker-compose.prod.yml logs backend | tail -50

# 6 - Document rollback
cat >> /root/kuwait-pos-deployment-log.txt <<EOF
---
Rollback Date: $(date +"%Y-%m-%d %H:%M:%S %Z")
Rolled Back To: <PREVIOUS_COMMIT_HASH>
Reason: <DESCRIBE_FAILURE_REASON>
Status: ROLLED_BACK
---
EOF
```

---

## Monitoring Checklist (Next 24-48 Hours)

### Check Every 6 Hours

```bash
# Quick health check script
cat > /root/kuwait-health-check.sh <<'SCRIPT'
#!/bin/bash
echo "=== Kuwait POS Health Check ==="
echo "Time: $(date)"
echo ""
echo "Service Status:"
docker compose -f /root/kuwait-pos/docker-compose.prod.yml ps
echo ""
echo "API Health:"
curl -sS https://kuwaitpos.duckdns.org/api/health | jq
echo ""
echo "Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
echo ""
echo "Recent Errors (last 50 lines):"
docker compose -f /root/kuwait-pos/docker-compose.prod.yml logs backend | tail -50 | grep -i "error\|fatal\|exception" || echo "No errors found"
echo ""
echo "==================================="
SCRIPT

chmod +x /root/kuwait-health-check.sh

# Run it now
/root/kuwait-health-check.sh

# Add to cron for automatic checks (every 6 hours)
(crontab -l 2>/dev/null; echo "0 */6 * * * /root/kuwait-health-check.sh >> /root/kuwait-health-log.txt 2>&1") | crontab -
```

### Watch For

- ✅ **No auth failures** - Check for "Invalid username or password" spikes
- ✅ **No sync duplicates** - Same offlineQueueId should not create multiple Sales
- ✅ **No memory leaks** - Backend RAM should stay < 200MB
- ✅ **No database locks** - Queries should complete in < 100ms
- ✅ **No 502 errors** - Nginx should always reach backend

---

## Success Criteria (All Must Be True)

- ✅ All services running (`docker compose ps` shows "Up")
- ✅ API responding (`/api/health` returns 200)
- ✅ Authentication working (login returns valid JWT)
- ✅ Sync endpoint accessible (`/api/sync/status` returns data)
- ✅ Idempotency working (duplicate offlineQueueId rejected)
- ✅ No errors in logs (past 5 minutes clean)
- ✅ SSL certificate valid (browser shows lock icon)
- ✅ Resource usage normal (< 1GB RAM total)

**If ANY criterion fails, execute rollback immediately.**

---

## Contact Information (In Case of Emergency)

- **Repository**: https://github.com/mallikamin/kuwait-petrol-pump
- **Deployment Protocol**: C:\Users\Malik\.claude\memory\DEPLOYMENT_SAFETY_PROTOCOL.md
- **Backup Location**: `/root/backups/` on server
- **Logs Location**: `docker compose logs backend`

---

**Document Status**: ✅ VERIFIED
**Last Updated**: 2026-03-28 17:15 UTC
**Next Review**: After first production deployment
