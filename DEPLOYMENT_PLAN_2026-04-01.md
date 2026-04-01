# Production Deployment Plan - 2026-04-01
**Server**: 64.226.65.80 (DigitalOcean)
**Target**: Deploy release/web-desktop-2026-04-01 (commit 99677a7)

---

## Pre-Flight Checks ✅

- [x] Current backend running: commit `12cfe3c` (Mar 29)
- [x] Current web deployed: Mar 29 build
- [x] All Docker containers healthy (backend, nginx, postgres, redis)
- [x] Volume mounts verified: postgres, redis data intact
- [x] Nginx config validated
- [x] Git remote configured: github.com/mallikamin/kuwait-petrol-pump.git

---

## Deployment Steps

### Step 1: Push Release Branch to GitHub

```bash
# On local machine (kuwait-petrol-pump directory)
cd kuwait-petrol-pump
git push origin release/web-desktop-2026-04-01
```

### Step 2: Pull New Code on Server

```bash
ssh root@64.226.65.80
cd /root/kuwait-pos

# Backup current version
cp .env .env.backup-$(date +%Y%m%d-%H%M%S)

# Fetch and checkout release branch
git fetch origin
git checkout release/web-desktop-2026-04-01
git pull origin release/web-desktop-2026-04-01

# Verify version
git log --oneline -1
# Should show: 99677a7 release: web+desktop production build 2026-04-01
```

### Step 3: Rebuild Backend Docker Image

```bash
cd /root/kuwait-pos

# Build new backend image
docker build -f Dockerfile.prod -t kuwaitpos-backend:2026-04-01 .
docker tag kuwaitpos-backend:2026-04-01 kuwaitpos-backend:latest

# Verify image created
docker images | grep kuwaitpos-backend
```

### Step 4: Update Web Files

```bash
cd /root/kuwait-pos

# Web files are mounted from apps/web/dist
# Verify new build exists
ls -la apps/web/dist/

# Should see:
# - index.html
# - assets/index-*.js
# - assets/index-*.css
```

### Step 5: Stop and Recreate Containers

```bash
cd /root/kuwait-pos

# Stop and remove containers (data volumes preserved)
docker-compose -f docker-compose.prod.yml down

# Start with new images
docker-compose -f docker-compose.prod.yml up -d

# Verify all containers started
docker ps
# Should show: kuwaitpos-backend, kuwaitpos-nginx, kuwaitpos-postgres, kuwaitpos-redis

# Check logs
docker logs kuwaitpos-backend --tail 50
docker logs kuwaitpos-nginx --tail 20
```

### Step 6: Health Checks

```bash
# Backend health
curl http://localhost:3000/api/health
# Expected: {"status":"ok","timestamp":"..."}

# Nginx health
curl http://localhost/health
# Expected: healthy

# Web app (from outside)
curl http://64.226.65.80/
# Expected: HTML content with new build hashes

# API via nginx
curl http://64.226.65.80/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

### Step 7: Smoke Tests

#### Test 1: Web App Loads
```bash
# From browser: http://64.226.65.80
# Expected: Login page displays (301 redirect to HTTPS)

# HTTPS (if cert is valid): https://kuwaitpos.duckdns.org
# Expected: Login page with new UI
```

#### Test 2: API Login
```bash
curl -X POST http://64.226.65.80/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Expected:
# {"accessToken":"...","refreshToken":"...","user":{...}}
```

#### Test 3: Protected Endpoint
```bash
# Use token from Step 2
curl http://64.226.65.80/api/dashboard/stats \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: Dashboard data
```

#### Test 4: Database Connectivity
```bash
docker exec kuwaitpos-postgres psql -U postgres -d petrolpump_prod -c "SELECT COUNT(*) FROM users;"

# Expected: Count of users
```

---

## Rollback Plan (If Needed)

### If Backend Fails

```bash
# Revert to previous image
docker tag kuwaitpos-backend:previous kuwaitpos-backend:latest
docker-compose -f docker-compose.prod.yml restart backend

# Or restore from previous commit
git checkout 12cfe3c
docker build -f Dockerfile.prod -t kuwaitpos-backend:latest .
docker-compose -f docker-compose.prod.yml restart backend
```

### If Web Fails

```bash
# Checkout previous version
git checkout 12cfe3c

# Restart nginx to remount old web files
docker-compose -f docker-compose.prod.yml restart nginx
```

### If Complete Rollback Needed

```bash
# Stop all
docker-compose -f docker-compose.prod.yml down

# Checkout previous version
git checkout master  # or 12cfe3c

# Restore .env
cp .env.backup-TIMESTAMP .env

# Rebuild and restart
docker build -f Dockerfile.prod -t kuwaitpos-backend:latest .
docker-compose -f docker-compose.prod.yml up -d
```

---

## Post-Deployment Monitoring

### First Hour

- [ ] Check backend logs: `docker logs -f kuwaitpos-backend`
- [ ] Check nginx logs: `docker logs -f kuwaitpos-nginx`
- [ ] Monitor container health: `docker ps` (should all show "healthy")
- [ ] Test login flow from web UI
- [ ] Test at least one transaction (fuel sale or meter reading)

### First 24 Hours

- [ ] Monitor error rates: `docker logs kuwaitpos-backend | grep ERROR`
- [ ] Check database connections: `docker exec kuwaitpos-postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"`
- [ ] Verify disk space: `df -h`
- [ ] Check memory usage: `free -h`
- [ ] Verify no container restarts: `docker ps -a`

---

## Success Criteria

- [x] All containers running and healthy
- [ ] Backend API responds on port 3000 and 80/443
- [ ] Web app loads without errors
- [ ] Login works
- [ ] Dashboard displays data
- [ ] Database queries succeed
- [ ] No errors in logs
- [ ] Version matches release: `99677a7`

---

## Notes

- **Database migrations**: Will run automatically on backend startup if needed
- **Environment variables**: Preserved in `.env` file (not changed)
- **SSL certificate**: Already configured for `kuwaitpos.duckdns.org`
- **Data volumes**: Preserved during container restart
- **Downtime estimate**: < 2 minutes (container restart time)

---

## Emergency Contacts

- **Developer**: Available during deployment
- **Server Access**: SSH root@64.226.65.80
- **Backup Location**: `/root/kuwait-pos/backups/`

---

**Ready to proceed with deployment? ✅**
