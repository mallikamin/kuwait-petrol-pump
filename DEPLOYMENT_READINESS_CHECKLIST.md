# Deployment Readiness Checklist
**Kuwait Petrol Pump POS - Sprint 1**

**Date**: 2026-03-28
**Target host**: use `DROPLET_IP` from `.env.server` (local-only; do not commit)
**Status**: NOT SIGNED OFF (requires evidence below)

---

## Pre-Deployment Requirements

### Infrastructure

- [ ] **New DigitalOcean Droplet Provisioned**
  - Size: 4GB RAM / 2 CPU / 80GB SSD ($24/month)
  - Region: Closest to Kuwait (Frankfurt/London/Singapore)
  - OS: Ubuntu 24.04 LTS
  - IP Address: from `.env.server` `DROPLET_IP`

- [ ] **DNS Configured**
  - Domain: kuwaitpos.duckdns.org
  - Points to: Droplet IP above
  - Verified: `nslookup kuwaitpos.duckdns.org` returns correct IP

- [ ] **Server Initial Setup Complete**
  - Docker installed: `docker --version`
  - Docker Compose installed: `docker compose version`
  - Firewall configured: `ufw status` (22, 80, 443 open)
  - Git installed: `git --version`

### Secrets & Configuration

- [ ] **Environment File Ready**
  - File: `/root/kuwait-pos/.env`
  - All variables filled (no `<REPLACE_ME>` placeholders)
  - Secrets generated with: `openssl rand -base64 32` (passwords) and `openssl rand -base64 64` (JWT)
  - File permissions: `chmod 600 .env`

- [ ] **QuickBooks Credentials (Production)**
  - Client ID: `________________`
  - Client Secret: `________________`
  - Redirect URI: `https://kuwaitpos.duckdns.org/api/quickbooks/callback`
  - Environment: `production`
  - Status: Stored in `.env` file

- [ ] **SSL Certificate Ready**
  - Method: Let's Encrypt (automatic via certbot in docker-compose)
  - Domain verified: kuwaitpos.duckdns.org resolves to droplet IP
  - Email for expiry alerts: `________________`

### Code Verification

- [ ] **Local Build Passing**
  ```bash
  cd C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump
  npm.cmd run build -w @petrol-pump/backend
  # Expected: tsc completes with zero errors
  ```

- [ ] **Local Tests Passing**
  ```bash
  npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
  # Expected: 11 passed, 11 total
  ```

- [ ] **Migration File Present**
  ```bash
  ls packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql
  # Expected: File exists
  ```

- [ ] **Git Repository Clean**
  ```bash
  git status
  # Expected: No uncommitted changes to critical files
  ```

- [ ] **Code Pushed to GitHub**
  ```bash
  git log origin/master..HEAD
  # Expected: Empty (all commits pushed)
  ```

---

## Deployment Execution Checklist

### Phase 1: Server Access & Backup

- [ ] SSH to server: `ssh root@<DROPLET_IP>`
- [ ] Navigate to project: `cd /root/kuwait-pos`
- [ ] Check service status: `docker compose -f docker-compose.prod.yml ps`
- [ ] Create backup: `docker exec kuwaitpos-postgres pg_dump -U postgres kuwait_pos | gzip > /root/backups/kuwait-pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz`
- [ ] Verify backup size: `ls -lh /root/backups/kuwait-pre-deploy-*.sql.gz` (> 1KB)
- [ ] Backup .env: `cp .env .env.backup-$(date +%Y%m%d-%H%M%S)`

**🛑 STOP**: Do not proceed unless backup is verified.

### Phase 2: Code Update

- [ ] Pull latest code: `git pull origin master`
- [ ] Verify migration present: `ls -lh packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql`

### Phase 3: Build & Deploy

- [ ] Stop backend: `docker compose -f docker-compose.prod.yml stop backend`
- [ ] Build backend: `docker compose -f docker-compose.prod.yml build backend`
- [ ] Start all services: `docker compose -f docker-compose.prod.yml up -d`
- [ ] Wait 30 seconds: `sleep 30`
- [ ] Check status: `docker compose -f docker-compose.prod.yml ps` (all "Up")
- [ ] Check logs: `docker compose -f docker-compose.prod.yml logs backend | tail -50` (no errors)

### Phase 4: Database Migration

- [ ] Apply migration: `docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy`
- [ ] Verify status: `docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status` (says "up to date")
- [ ] Check indexes: `docker exec kuwaitpos-postgres psql -U postgres kuwait_pos -c "SELECT indexname FROM pg_indexes WHERE tablename = 'User' AND indexname LIKE '%organizationId%';"`

### Phase 5: Smoke Tests

- [ ] **Health Check**
  ```bash
  curl -sS https://kuwaitpos.duckdns.org/api/health
  # Expected: {"status":"ok",...}
  ```

- [ ] **Authentication Test**
  ```bash
  TOKEN=$(curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"YOUR_PASSWORD"}' | jq -r '.access_token')
  echo "${TOKEN:0:40}"
  # Expected: JWT token (starts with eyJhbGc...)
  ```

- [ ] **Sync Status Test**
  ```bash
  curl -sS https://kuwaitpos.duckdns.org/api/sync/status -H "Authorization: Bearer $TOKEN"
  # Expected: {"pending":0,"failed":0,...}
  ```

- [ ] **Idempotency Test**
  - First sync call: Should create sale
  - Second sync call (same payload): Should NOT create duplicate
  - Database check: `SELECT COUNT(*) FROM "Sale" WHERE "offlineQueueId" = 'test-001';` returns 1

- [ ] **SSL Certificate Test**
  ```bash
  curl -v https://kuwaitpos.duckdns.org/api/health 2>&1 | grep "SSL certificate verify ok"
  # Expected: Message appears
  ```

### Phase 6: Post-Deployment Verification

- [ ] **Resource Usage Check**
  ```bash
  docker stats --no-stream
  # Expected: Backend < 200MB, PostgreSQL < 300MB, Redis < 50MB
  ```

- [ ] **Log Review (No Errors)**
  ```bash
  docker compose -f docker-compose.prod.yml logs backend | tail -100 | grep -i "error\|fatal"
  # Expected: Empty output or only INFO-level logs
  ```

- [ ] **Browser Test**
  - Open: `https://kuwaitpos.duckdns.org`
  - Expected: No SSL warnings, dashboard loads
  - Login works: Username/password accepted
  - Dashboard functional: No console errors

---

## Success Criteria (All Must Pass)

### Critical Checks

- ✅ **Services Running**: All containers "Up" for > 1 minute
- ✅ **API Responding**: `/api/health` returns 200 OK
- ✅ **Auth Working**: Login returns valid JWT token
- ✅ **Sync Accessible**: `/api/sync/status` returns data
- ✅ **Idempotency Working**: Duplicate sync rejected (no DB duplicates)
- ✅ **No Errors**: Logs clean for past 5 minutes
- ✅ **SSL Valid**: Browser shows green lock icon
- ✅ **Resources Normal**: Total RAM usage < 1GB

### Non-Critical (Can Be Fixed Later)

- ⚠️ QuickBooks OAuth not yet configured (needs production credentials)
- ⚠️ Integration tests pending (need real org-linked data)
- ⚠️ Mobile app not yet deployed (Play Store/App Store pending)

---

## Rollback Plan (If Deployment Fails)

### Trigger Rollback If:

- 🔴 Any service won't start (remains in "Exit 1" state)
- 🔴 Migration fails with error
- 🔴 API returns 500 errors
- 🔴 Auth completely broken (no logins possible)
- 🔴 Database corruption detected
- 🔴 RAM usage exceeds 3.5GB (out of memory imminent)

### Rollback Steps:

```bash
# 1. Stop backend
docker compose -f docker-compose.prod.yml stop backend

# 2. Restore database
ROLLBACK_FILE="/root/backups/kuwait-pre-deploy-TIMESTAMP.sql.gz"  # Use actual timestamp
docker exec kuwaitpos-postgres psql -U postgres -c "DROP DATABASE kuwait_pos;"
docker exec kuwaitpos-postgres psql -U postgres -c "CREATE DATABASE kuwait_pos;"
gunzip -c "$ROLLBACK_FILE" | docker exec -i kuwaitpos-postgres psql -U postgres kuwait_pos

# 3. Revert code
git log --oneline -5  # Find previous commit hash
git reset --hard <PREVIOUS_COMMIT_HASH>

# 4. Rebuild and restart
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d

# 5. Verify rollback
curl -sS https://kuwaitpos.duckdns.org/api/health
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend | tail -50
```

**Rollback Time**: 5 minutes (database restore is fastest step)

---

## Post-Deployment Monitoring

### First 24 Hours - Check Every 6 Hours

Run health check script:
```bash
/root/kuwait-health-check.sh
```

Look for:
- ✅ No auth failures (check for "Invalid username" spikes)
- ✅ No sync duplicates (same offlineQueueId creates only 1 Sale)
- ✅ No memory leaks (RAM stays stable)
- ✅ No database locks (queries < 100ms)
- ✅ No 502 errors (nginx always reaches backend)

### First Week - Daily Checks

- Check disk space: `df -h` (should have > 20GB free)
- Check backup creation: `ls -lh /root/backups/` (daily backups appearing)
- Review error logs: `docker compose logs backend | grep ERROR`
- Verify SSL expiry: `certbot certificates` (expires in ~90 days)

---

## Documentation & Support

### Key Files

- **Deployment Sequence**: `PRODUCTION_DEPLOYMENT_SEQUENCE.md` (full detailed steps)
- **Quick Reference**: `DEPLOY_QUICK_REFERENCE.sh` (copy-paste commands)
- **This Checklist**: `DEPLOYMENT_READINESS_CHECKLIST.md` (you are here)
- **Safety Protocol**: `C:\Users\Malik\.claude\memory\DEPLOYMENT_SAFETY_PROTOCOL.md`

### Emergency Contacts

- **Repository**: https://github.com/mallikamin/kuwait-petrol-pump
- **Backup Location**: `/root/backups/` on server
- **Log Command**: `docker compose -f docker-compose.prod.yml logs backend`
- **Health Check URL**: https://kuwaitpos.duckdns.org/api/health

---

## Sign-Off

### Pre-Deployment Review

- [ ] Infrastructure ready (droplet provisioned)
- [ ] Configuration complete (all secrets filled)
- [ ] Code verified (build + tests passing)
- [ ] Team notified (stakeholders aware of deployment)
- [ ] Rollback plan reviewed (know how to revert)
- [ ] Monitoring setup (health check script ready)

### Deployment Authorization

**Deployed By**: ________________
**Deployment Date**: ________________
**Deployment Time**: ________________ UTC
**Git Commit**: ________________

**Authorized By**: ________________
**Signature**: ________________

---

## Post-Deployment Sign-Off

- [ ] All smoke tests passed
- [ ] No errors in logs (first 10 minutes)
- [ ] Monitoring confirmed working
- [ ] Stakeholders notified (deployment complete)
- [ ] Documentation updated (deployment log)

**Status**: ✅ **DEPLOYMENT SUCCESSFUL** / 🔴 **ROLLED BACK**
**Verified By**: ________________
**Verification Time**: ________________ UTC

---

**Document Version**: 1.0
**Last Updated**: 2026-03-28 17:20 UTC
**Next Review**: After first production deployment
