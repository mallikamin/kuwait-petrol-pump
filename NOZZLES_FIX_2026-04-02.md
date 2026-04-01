# Nozzles Management - 403 Permission Fix

## Issue
**Time**: 2026-04-02 21:30 UTC
**Error**: `403 Forbidden` when editing/activating nozzles
**Endpoint**: PATCH /api/nozzles/:id
**User Role**: `admin` (lowercase)

## Root Cause
Backend permission check expected **uppercase** roles:
```typescript
// Failed check
if (!['ADMIN', 'MANAGER'].includes(req.user.role))
```

User token contained **lowercase** role `"admin"`, which didn't match the check.

## Fix Applied

### Code Change
**File**: `apps/backend/src/modules/nozzles/nozzles.controller.ts:81`

```typescript
// Before
if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}

// After
if (!['ADMIN', 'MANAGER', 'admin', 'manager'].includes(req.user.role)) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

### Deployment Process

**Problem**: Docker image wasn't rebuilding from source code changes.

**Solution**:
```bash
# On production server
cd /root/kuwait-pos
git pull origin deploy/clean-2026-04-01

# Manual rebuild (docker-compose build didn't work due to missing build context)
docker build -f Dockerfile.prod -t kuwaitpos-backend:latest .

# Restart backend
docker compose -f docker-compose.prod.yml up -d backend
```

**Build Time**: ~3 minutes
**Downtime**: ~15 seconds (container restart)

## Verification

**Test Command**:
```bash
TOKEN=$(curl -s https://kuwaitpos.duckdns.org/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"AdminPass123"}' | \
  grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

curl -X PATCH "https://kuwaitpos.duckdns.org/api/nozzles/c1111111-1111-1111-1111-111111111111" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"is_active":true}'
```

**Result**: ✅ 200 OK
```json
{
  "id": "c1111111-1111-1111-1111-111111111111",
  "nozzleNumber": 1,
  "fuelType": "Premium Gasoline",
  "isActive": true
}
```

## Related Issues

This is the **same pattern** as previous fixes:
- TASK3_ROLE_NORMALIZATION_FIX_2026-04-02.md (shifts endpoints)
- HOTFIX_2026-04-01_shifts.md (shift opening)

**Lesson**: All permission checks need to support both uppercase and lowercase roles until database is normalized.

## Status
✅ **RESOLVED** - 2026-04-02 21:45 UTC

**Commits**:
- 7277b15: "fix: nozzles PATCH 403 - support lowercase admin/manager roles"
- Docker rebuild: kuwaitpos-backend:latest (sha256:c51bd259...)

**Production**: https://kuwaitpos.duckdns.org/nozzles

## Next Steps

### Immediate (User Testing)
1. Hard refresh page (Ctrl+Shift+R)
2. Test edit nozzle functionality
3. Test activate/deactivate
4. Test create new dispensing unit
5. Test create new nozzle

### Long-term (Technical Debt)
1. **Normalize roles in database** - convert all to lowercase
2. **Add database migration** to ensure consistency
3. **Update seed script** to use lowercase roles
4. **Centralize role checks** - create middleware that normalizes role before checks
5. **Add integration tests** for all permission checks

## Deployment Notes for Future

### ⚠️ Docker Build Issue
`docker compose -f docker-compose.prod.yml build backend` **does not work** because:
- The backend service uses `image: kuwaitpos-backend:latest`
- No `build:` context is defined in docker-compose.prod.yml
- Must manually rebuild: `docker build -f Dockerfile.prod -t kuwaitpos-backend:latest .`

### Proper Deployment Flow
```bash
# 1. Pull latest code
git pull origin <branch>

# 2. Rebuild backend image
docker build -f Dockerfile.prod -t kuwaitpos-backend:latest .

# 3. Restart services
docker compose -f docker-compose.prod.yml up -d backend

# 4. Verify health
curl https://kuwaitpos.duckdns.org/api/health

# 5. Test changed endpoint
curl -X PATCH https://kuwaitpos.duckdns.org/api/nozzles/:id ...
```

### Build Performance
- Full rebuild: ~3 minutes
- pnpm install: ~1m 13s
- TypeScript compile: ~27s
- Prisma generate: ~7s
- Docker layers: ~2m 40s

---

**Issue Closed**: User can now edit and manage nozzles without permission errors.
