# Kuwait POS - Verified Deployment Plan

**Date**: 2026-03-28
**Target**: DigitalOcean droplet (see .env.server:DROPLET_IP)
**Status**: SERVER EMPTY - Fresh deployment required

---

## Evidence-Based Current State

### Local Verification (PASSED)
```
[EVIDENCE 1] Build passes:
$ npm.cmd run build -w @petrol-pump/backend
> tsc
(exit 0, zero errors)

[EVIDENCE 2] Tests pass:
$ npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
PASS src/modules/sync/sync.service.test.ts
Tests: 11 passed, 11 total
Time: 0.331s

[EVIDENCE 3] Migration exists:
packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql
(compound unique indexes on organizationId)
```

### Server State (VERIFIED)
```
[EVIDENCE 4] Server check:
$ ssh root@<DROPLET_IP> "cd /root/kuwait-pos && docker compose ps"
> Directory or services not found

Conclusion: Server is provisioned but empty. No deployment exists yet.
```

### Droplet Details (from .env.server)
- IP: See .env.server line 7 (DROPLET_IP)
- SSH User: root
- SSH Password: See .env.server line 14 (SSH_PASSWORD) - DO NOT PRINT
- Region: Frankfurt (FRA1)
- Specs: 4GB RAM / 2 vCPU / 80GB SSD
- OS: Ubuntu 24.04 LTS
- Domain: kuwaitpos.duckdns.org
- Status: Created 2026-03-27, not yet configured

### IP Mismatch Issues Found
Multiple docs hardcode wrong IP (72.255.51.78):
- DEPLOYMENT.md line 3, 34, 45
- HOSTING_GUIDE.md line 4, 24, 38, 44
- DEPLOYMENT_QUICK_START.md line 7, 16

**FIX**: All new deployment docs reference .env.server:DROPLET_IP (not hardcoded).

---

## Gate-Based Deployment Protocol

### GATE 0: Pre-Deployment Checklist
Run these commands and verify output BEFORE connecting to server:

```bash
# G0.1 - Verify build
cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump"
npm.cmd run build -w @petrol-pump/backend
# GATE: Exit code must be 0

# G0.2 - Verify tests
npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
# GATE: "11 passed, 11 total"

# G0.3 - Verify migration file
ls packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql
# GATE: File must exist

# G0.4 - Get droplet IP from .env.server
grep DROPLET_IP .env.server
# GATE: Shows DROPLET_IP=<IP_ADDRESS>
```

**STOP if any gate fails. Fix locally before proceeding.**

---

### GATE 1: Server Access & Environment Setup

```bash
# G1.1 - SSH to server (password is in .env.server:SSH_PASSWORD)
ssh root@<DROPLET_IP>

# G1.2 - Verify system
uname -a
# GATE: Should show "Ubuntu" and "24.04" or "22.04"

# G1.3 - Install dependencies
apt update && apt upgrade -y
apt install -y docker.io docker-compose git curl wget jq

# G1.4 - Verify Docker
docker --version
docker compose version
# GATE: Both commands must succeed (v20+ and v2+ respectively)

# G1.5 - Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
# GATE: Shows 22, 80, 443 ALLOW

# G1.6 - Create project directory
mkdir -p /root/kuwait-pos
cd /root/kuwait-pos

# G1.7 - Clone repository
git clone https://github.com/mallikamin/kuwait-petrol-pump.git .
ls -la
# GATE: Should show apps/, packages/, docker-compose.prod.yml, etc.

# G1.8 - Create .env file
cp .env.production.example .env

# G1.9 - Edit .env with real secrets
nano .env
# Manual step: Fill all <REPLACE_ME> values with:
# - POSTGRES_PASSWORD (generate: openssl rand -base64 32)
# - REDIS_PASSWORD (generate: openssl rand -base64 32)
# - JWT_SECRET (generate: openssl rand -base64 64)
# - JWT_REFRESH_SECRET (generate: openssl rand -base64 64)
# - QUICKBOOKS_CLIENT_ID (from Intuit Developer Portal)
# - QUICKBOOKS_CLIENT_SECRET (from Intuit Developer Portal)

# G1.10 - Verify .env has no placeholders
grep -E "<REPLACE|YOUR_" .env
# GATE: Should return empty (no matches)

# G1.11 - Secure .env
chmod 600 .env
ls -lh .env
# GATE: Shows "-rw-------" (600 permissions)
```

**STOP if any gate fails. Do not proceed to GATE 2.**

---

### GATE 2: Database & Services Startup

```bash
# G2.1 - Start PostgreSQL and Redis only (not backend yet)
docker compose -f docker-compose.prod.yml up -d postgres redis
sleep 10

# G2.2 - Verify database is running
docker compose -f docker-compose.prod.yml ps postgres
# GATE: Status must be "Up"

# G2.3 - Test PostgreSQL connection
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "SELECT version();"
# GATE: Should show PostgreSQL version

# G2.4 - Verify Redis is running
docker compose -f docker-compose.prod.yml ps redis
# GATE: Status must be "Up"

# G2.5 - Test Redis connection
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
# GATE: Should return "PONG"
```

**STOP if any gate fails. Fix database/Redis before proceeding.**

---

### GATE 3: Backend Deployment

```bash
# G3.1 - Build backend image
docker compose -f docker-compose.prod.yml build backend

# G3.2 - Start backend
docker compose -f docker-compose.prod.yml up -d backend
sleep 30

# G3.3 - Verify backend is running
docker compose -f docker-compose.prod.yml ps backend
# GATE: Status must be "Up"

# G3.4 - Check backend logs for errors
docker compose -f docker-compose.prod.yml logs backend | tail -50
# GATE: Should see "Server started on port 3000" and NO "ERROR" or "FATAL"

# G3.5 - Test backend health (internal)
docker compose -f docker-compose.prod.yml exec backend curl -s http://localhost:3000/api/health
# GATE: Should return {"status":"ok",...}
```

**STOP if any gate fails. Check logs and fix before proceeding.**

---

### GATE 4: Database Migration

```bash
# G4.1 - Run migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Expected output:
# "1 migration found in prisma/migrations"
# "The following migration(s) have been applied:"
# "20260328063646_tenant_scoped_uniqueness"

# GATE: Migration must complete without errors

# G4.2 - Verify migration status
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status
# GATE: Must say "Database schema is up to date!"

# G4.3 - Verify indexes were created
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'User' AND indexname LIKE '%organizationId%';"
# GATE: Should show at least one index like "User_username_organizationId_key"
```

**STOP if any gate fails. Do NOT start nginx.**

---

### GATE 5: SSL Certificate Setup

```bash
# G5.1 - Install certbot
apt install -y certbot

# G5.2 - Verify DNS points to this server
dig +short kuwaitpos.duckdns.org
# GATE: Should return this droplet's IP (from .env.server:DROPLET_IP)

# G5.3 - Stop nginx (if running)
docker compose -f docker-compose.prod.yml stop nginx

# G5.4 - Obtain certificate (standalone mode)
certbot certonly --standalone \
  -d kuwaitpos.duckdns.org \
  --email YOUR_EMAIL@example.com \
  --agree-tos \
  --non-interactive

# GATE: Should say "Successfully received certificate"

# G5.5 - Verify certificate files exist
ls -lh /etc/letsencrypt/live/kuwaitpos.duckdns.org/
# GATE: Should show fullchain.pem and privkey.pem

# G5.6 - Copy certificates to Docker volume
docker run --rm \
  -v kuwait_certbot_etc:/certs \
  -v /etc/letsencrypt:/host-certs:ro \
  alpine sh -c "cp -rL /host-certs/* /certs/"

# G5.7 - Verify certificates in volume
docker run --rm \
  -v kuwait_certbot_etc:/certs \
  alpine ls -lh /certs/live/kuwaitpos.duckdns.org/
# GATE: Should show fullchain.pem and privkey.pem
```

**STOP if any gate fails. Fix DNS or certificates before proceeding.**

---

### GATE 6: Nginx & External Access

```bash
# G6.1 - Start nginx
docker compose -f docker-compose.prod.yml up -d nginx

# G6.2 - Verify nginx is running
docker compose -f docker-compose.prod.yml ps nginx
# GATE: Status must be "Up"

# G6.3 - Check nginx logs
docker compose -f docker-compose.prod.yml logs nginx | tail -50
# GATE: No "error" or "failed" messages related to SSL

# G6.4 - Test HTTP redirect (should redirect to HTTPS)
curl -I http://kuwaitpos.duckdns.org
# GATE: Should show "301 Moved Permanently" and "Location: https://..."

# G6.5 - Test HTTPS health endpoint
curl -sS https://kuwaitpos.duckdns.org/api/health
# GATE: Should return {"status":"ok",...}

# G6.6 - Verify SSL certificate (no -k flag)
curl -v https://kuwaitpos.duckdns.org/api/health 2>&1 | grep "SSL certificate verify"
# GATE: Should show "SSL certificate verify ok"
```

**STOP if any gate fails. Fix nginx config or SSL before proceeding.**

---

### GATE 7: Authentication Smoke Test

```bash
# G7.1 - Attempt login with default admin (if seeded)
TOKEN=$(curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"REPLACE_WITH_REAL_PASSWORD"}' \
  | jq -r '.access_token')

# G7.2 - Verify token received
echo "Token (first 40 chars): ${TOKEN:0:40}"
# GATE: Should start with "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"

# If empty or "null", check error:
curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"REPLACE_WITH_REAL_PASSWORD"}'
# GATE: Should return {"access_token":"...","user":{...}}
# NOT {"error":"Invalid username or password"}
```

**STOP if gate fails. Seed default user or check auth service logs.**

---

### GATE 8: Sync Endpoint Smoke Test

```bash
# G8.1 - Test authenticated sync status endpoint
curl -sS https://kuwaitpos.duckdns.org/api/sync/status \
  -H "Authorization: Bearer $TOKEN"
# GATE: Should return {"pending":0,"failed":0,"completed":...}
# NOT 401 Unauthorized

# G8.2 - Verify organizationId is enforced
# (This will fail if no organization exists for the user, which is expected)
curl -sS https://kuwaitpos.duckdns.org/api/sync/status \
  -H "Authorization: Bearer $TOKEN" \
  | jq
# GATE: No 500 errors, response is valid JSON
```

**STOP if gate fails. Check TenantValidator integration.**

---

### GATE 9: Idempotency Test (CRITICAL)

This is the most important test - verifies offline sync won't create duplicates.

```bash
# G9.1 - Get real UUIDs from database (need valid branchId, shiftInstanceId, userId)
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT id FROM \"Branch\" LIMIT 1;"
# Copy the UUID

docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT id FROM \"ShiftInstance\" WHERE status = 'active' LIMIT 1;"
# Copy the UUID (or create a shift first if none exist)

docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT id FROM \"User\" WHERE role = 'cashier' LIMIT 1;"
# Copy the UUID

# G9.2 - Create test sync payload with real UUIDs
cat > /tmp/idempotency-test.json <<'JSON'
{
  "deviceId": "gate9-test-device",
  "sales": [
    {
      "offlineQueueId": "gate9-idempotency-001",
      "branchId": "PASTE_REAL_BRANCH_UUID_HERE",
      "shiftInstanceId": "PASTE_REAL_SHIFT_UUID_HERE",
      "saleDate": "2026-03-28T12:00:00Z",
      "saleType": "fuel",
      "totalAmount": 1000,
      "taxAmount": 0,
      "discountAmount": 0,
      "paymentMethod": "cash",
      "cashierId": "PASTE_REAL_USER_UUID_HERE",
      "fuelSales": []
    }
  ]
}
JSON

# G9.3 - First sync (should create sale)
echo "=== FIRST SUBMISSION ==="
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/idempotency-test.json \
  | jq

# GATE: Should return {"synced":{"sales":1},"failed":{"sales":0}}

# G9.4 - Count sales in database (should be 1)
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT COUNT(*) FROM \"Sale\" WHERE \"offlineQueueId\" = 'gate9-idempotency-001';"
# GATE: count = 1

# G9.5 - Second sync with SAME payload (should be idempotent)
echo "=== SECOND SUBMISSION (IDEMPOTENCY CHECK) ==="
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/idempotency-test.json \
  | jq

# GATE: Should return {"synced":{"sales":0},"failed":{"sales":0}}
# (0 synced because it already exists)

# G9.6 - Count sales in database again (MUST STILL BE 1)
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT COUNT(*) FROM \"Sale\" WHERE \"offlineQueueId\" = 'gate9-idempotency-001';"
# GATE: count = 1 (NOT 2)

# G9.7 - Verify compound unique constraint is working
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres kuwait_pos -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'Sale' AND indexname LIKE '%offlineQueueId%organizationId%';"
# GATE: Should show index like "Sale_offlineQueueId_organizationId_key"
```

**CRITICAL GATE: If count = 2, ROLLBACK immediately. Idempotency is broken.**

---

### GATE 10: Resource Usage & Stability

```bash
# G10.1 - Check resource usage
docker stats --no-stream

# GATE: Verify:
# - Backend RAM: < 300MB
# - PostgreSQL RAM: < 400MB
# - Redis RAM: < 100MB
# - Nginx RAM: < 50MB
# Total: < 1GB (well under 4GB limit)

# G10.2 - Check disk usage
df -h
# GATE: Root partition should have > 40GB free

# G10.3 - Verify all services still running after 5 minutes
sleep 300
docker compose -f docker-compose.prod.yml ps
# GATE: All services "Up" with uptime > 5 minutes

# G10.4 - Check for any crashes in logs
docker compose -f docker-compose.prod.yml logs --since 10m | grep -i "error\|fatal\|exception"
# GATE: No critical errors (ignore deprecation warnings)
```

**STOP if any gate fails. Investigate resource issues.**

---

## Post-Deployment Tasks

### 1. Setup Automated Backups

```bash
# Create backup directory
mkdir -p /root/backups

# Create backup script
cat > /root/kuwait-backup.sh <<'SCRIPT'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/root/backups/kuwait-$TIMESTAMP.sql.gz"

# Backup database
docker compose -f /root/kuwait-pos/docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres kuwait_pos | gzip > "$BACKUP_FILE"

# Verify backup
if [ -s "$BACKUP_FILE" ]; then
  echo "Backup successful: $BACKUP_FILE ($(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE") bytes)"
else
  echo "ERROR: Backup failed!" >&2
  exit 1
fi

# Delete backups older than 30 days
find /root/backups -name "kuwait-*.sql.gz" -mtime +30 -delete
SCRIPT

chmod +x /root/kuwait-backup.sh

# Test backup script
/root/kuwait-backup.sh
ls -lh /root/backups/

# Add to crontab (daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /root/kuwait-backup.sh >> /root/backup.log 2>&1") | crontab -
crontab -l
```

### 2. Setup Monitoring Script

```bash
cat > /root/kuwait-health.sh <<'SCRIPT'
#!/bin/bash
echo "=== Kuwait POS Health Check ==="
echo "Time: $(date)"
echo ""

echo "Services:"
docker compose -f /root/kuwait-pos/docker-compose.prod.yml ps

echo ""
echo "API Health:"
curl -sS https://kuwaitpos.duckdns.org/api/health | jq -r '.status' || echo "FAILED"

echo ""
echo "Recent Errors:"
docker compose -f /root/kuwait-pos/docker-compose.prod.yml logs backend --since 1h | grep -i "error\|fatal" | tail -10 || echo "None"

echo ""
echo "Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
echo "==================================="
SCRIPT

chmod +x /root/kuwait-health.sh

# Test it
/root/kuwait-health.sh

# Add to crontab (every 6 hours)
(crontab -l 2>/dev/null; echo "0 */6 * * * /root/kuwait-health.sh >> /root/health.log 2>&1") | crontab -
```

### 3. Document Deployment

```bash
cat > /root/deployment-info.txt <<INFO
Kuwait POS Deployment Record
============================
Date: $(date +"%Y-%m-%d %H:%M:%S %Z")
Droplet IP: $(curl -s ifconfig.me)
Domain: kuwaitpos.duckdns.org
Git Commit: $(cd /root/kuwait-pos && git rev-parse HEAD)
Migration: 20260328063646_tenant_scoped_uniqueness

Services:
- Backend: https://kuwaitpos.duckdns.org/api/health
- PostgreSQL: port 5432 (internal)
- Redis: port 6379 (internal)
- Nginx: ports 80, 443

Credentials: See .env.server in local repo (NOT on server)
Backups: /root/backups/ (daily 3 AM)
Monitoring: /root/kuwait-health.sh (every 6 hours)
INFO

cat /root/deployment-info.txt
```

---

## Rollback Procedure

If ANY gate fails after GATE 4 (migration), follow this procedure:

```bash
# STEP 1: Stop all services
cd /root/kuwait-pos
docker compose -f docker-compose.prod.yml down

# STEP 2: Restore latest backup (if one exists)
LATEST_BACKUP=$(ls -t /root/backups/kuwait-*.sql.gz | head -1)
echo "Restoring from: $LATEST_BACKUP"

# Drop and recreate database
docker compose -f docker-compose.prod.yml up -d postgres
sleep 5
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "DROP DATABASE kuwait_pos;"
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "CREATE DATABASE kuwait_pos;"

# Restore backup
gunzip -c "$LATEST_BACKUP" | docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres kuwait_pos

# STEP 3: Revert code to previous commit
cd /root/kuwait-pos
git log --oneline -5
git reset --hard <PREVIOUS_COMMIT_HASH>

# STEP 4: Rebuild and restart
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d

# STEP 5: Verify rollback
curl -sS https://kuwaitpos.duckdns.org/api/health
docker compose -f docker-compose.prod.yml ps

# STEP 6: Document rollback
echo "ROLLBACK at $(date): Reason <DESCRIBE_HERE>" >> /root/deployment-log.txt
```

---

## Success Criteria (All Must Pass)

- [ ] All 10 gates passed without errors
- [ ] Build passes locally (npm build)
- [ ] Tests pass locally (11/11)
- [ ] Migration applied successfully
- [ ] API health endpoint returns 200
- [ ] Authentication works (login returns JWT)
- [ ] Sync endpoint accessible
- [ ] Idempotency verified (duplicate sync rejected, DB count = 1 not 2)
- [ ] SSL certificate valid (no browser warnings)
- [ ] Resource usage < 1GB total
- [ ] No errors in logs (past 10 minutes)
- [ ] Automated backups configured
- [ ] Monitoring script running

---

## Known Issues & Limitations

1. **Integration tests skipped**: Require real organization-linked data (not blocking)
2. **QuickBooks not configured**: Need production credentials from user (not blocking)
3. **Mobile app not deployed**: Play Store/App Store submission pending (separate task)
4. **Seeding required**: Must manually create first organization, branch, user, shift
5. **Email notifications**: Not yet configured (SMTP settings needed)

---

## Document Status

**Created**: 2026-03-28
**Evidence**: Build + test logs, server empty verification, migration file exists
**Next Action**: Execute gates 1-10 sequentially
**Estimated Time**: 60-90 minutes (including SSL certificate wait time)

---

**RULE: Do NOT claim "PRODUCTION-READY" unless ALL 10 gates pass with evidence.**
