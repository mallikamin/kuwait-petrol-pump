# IP & Docker Compose File Fix Summary

**Date**: 2026-03-28 18:30 UTC
**Fixed By**: Correcting drift from repo truth

---

## Issue 1: Wrong IP Hardcoded

**Problem**: Multiple docs hardcoded 72.255.51.78
**Correct IP**: 64.226.65.80 (from .env.server line 7: DROPLET_IP)

### Files Fixed:
- DEPLOYMENT.md (lines 38, 49, 329, 350, 392)
- HOSTING_GUIDE.md (lines 28, 42, 43, 48, 162, 373, 425, 439)
- DEPLOYMENT_QUICK_START.md (line 20)
- PROJECT_COMPLETE.md (lines 237, 269, 464)
- DEPLOYMENT_SUMMARY.md (lines 4, 338, 389)

### Verification:
```bash
cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump"
grep -r "72\.255\.51\.78" *.md | grep -v "historical\|wrong\|mismatch"
# Should return only intentional historical notes
```

---

## Issue 2: Wrong Compose File Referenced

**Problem**: Scripts/docs referenced docker-compose.yml
**Correct File**: docker-compose.prod.yml (the actual production file)

### Files Fixed:
- scripts/deploy.sh (line 20)
- scripts/health-check.sh (line 108)
- scripts/restore-db.sh (lines 70, 79, 86)
- DEPLOYMENT.md (lines 360, 479)
- DEPLOYMENT_QUICK_START.md (lines 64, 216)

### Verification:
```bash
ls -la docker-compose*.yml
# Should show: docker-compose.prod.yml exists
# Should NOT show: docker-compose.yml

grep -r "docker-compose\.yml" scripts/*.sh *.md | grep -v "docker-compose.prod.yml"
# Should return only historical notes or deprecation warnings
```

---

## Canonical References

### For Droplet IP:
**Source of Truth**: `.env.server` line 7
```bash
DROPLET_IP=64.226.65.80
```

**In Scripts**:
```bash
DROPLET_IP=$(grep DROPLET_IP .env.server | cut -d= -f2)
ssh root@$DROPLET_IP
```

**In Docs**:
```markdown
# SSH to server (use DROPLET_IP from .env.server:7, password from line 14)
ssh root@64.226.65.80
```

### For Docker Compose:
**File**: `docker-compose.prod.yml` (NOT docker-compose.yml)

**In Scripts**:
```bash
COMPOSE_FILE="/root/kuwait-pos/docker-compose.prod.yml"
docker compose -f "$COMPOSE_FILE" up -d
```

**In Commands**:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

---

## Remaining References (Intentional)

### 72.255.51.78 (Historical Notes Only):
- VERIFIED_DEPLOYMENT_PLAN.md line 49 - Documents the mismatch
- CURRENT_STATUS_2026-03-28.md lines 77, 203 - Records the error
- This file - Explains the fix

### docker-compose.yml (Deprecation Warnings):
- BUILD_STATUS.md line 216 - Old project structure doc
- ERROR_LOG.md line 166 - Historical error documentation
- PROGRESS_SUMMARY.md line 117 - Old summary
- apps/web/DEPLOYMENT.md line 113 - Old frontend guide

These are intentional documentation, not active commands.

---

## Local Verification Commands (Use npm, not pnpm)

**Correct**:
```bash
npm.cmd run build -w @petrol-pump/backend
npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
```

**Wrong** (pnpm blocked by execution policy on Windows):
```bash
pnpm --filter @petrol-pump/backend run build  # FAILS
```

---

## Gate Rule for All Docs

**NEVER claim "PRODUCTION-READY" or "LOW RISK" unless:**
1. You paste exact command outputs into status doc
2. Build output shows zero errors
3. Test output shows all passing
4. Server state verified via SSH
5. Migration file exists and is validated

**Evidence Required**:
```
[EVIDENCE 1] Build output:
$ npm.cmd run build -w @petrol-pump/backend
> tsc
(exit 0)

[EVIDENCE 2] Test output:
$ npm.cmd test -w @petrol-pump/backend -- sync.service.test.ts --runInBand
Tests: 11 passed, 11 total

[EVIDENCE 3] Server state:
$ ssh root@64.226.65.80 "docker compose -f /root/kuwait-pos/docker-compose.prod.yml ps"
(actual output here)
```

---

**Status**: ALL FIXES APPLIED
**Verified**: 2026-03-28 18:30 UTC
**Next Action**: Execute VERIFIED_DEPLOYMENT_PLAN.md gates 1-10 on 64.226.65.80
