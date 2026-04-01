# Production Deployment - Final Checklist

**Date**: 2026-03-31
**Target**: 64.226.65.80 (Frankfurt)
**Apps**: Backend API + Web Dashboard + Mobile App

---

## Pre-Deployment Status

### ✅ Ready
- [x] Backend code complete (all features implemented)
- [x] Web dashboard code complete (all features implemented)
- [x] Mobile app code complete (OCR + validation + back-dated entry)
- [x] Database schema finalized
- [x] Environment variables configured
- [x] Docker Compose production config ready
- [x] nginx SSL configuration ready
- [x] Domain configured (kuwaitpos.duckdns.org)

### ⏳ In Progress
- [ ] Mobile APK building locally (~5 min remaining)

---

## Deployment Sequence

### Phase 1: Backend API (5 min)

```bash
# 1. Commit all changes
cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump"
git add .
git commit -m "feat: production deployment - mobile OCR + backend + web ready"
git push origin chore/web-p0-postdeploy-revalidation-2026-03-30

# 2. SSH to production server
ssh root@64.226.65.80

# 3. Pull latest code
cd ~/kuwait-pos
git pull origin chore/web-p0-postdeploy-revalidation-2026-03-30

# 4. Deploy backend
docker compose -f docker-compose.prod.yml up -d --build backend

# 5. Run migrations (if any)
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# 6. Verify
curl https://kuwaitpos.duckdns.org/api/health
# Should return: {"status":"ok"}
```

---

### Phase 2: Web Dashboard (3 min)

```bash
# 1. Build locally
cd apps/web
npm run build

# 2. Deploy to server
scp -r dist root@64.226.65.80:~/kuwait-pos/apps/web/

# 3. Restart nginx
ssh root@64.226.65.80 "cd ~/kuwait-pos && docker compose -f docker-compose.prod.yml up -d --force-recreate nginx"

# 4. Verify
# Open: https://kuwaitpos.duckdns.org
# Should load login page
```

---

### Phase 3: Mobile App (Immediate)

```bash
# 1. APK location (after build completes):
apps/mobile/android/app/build/outputs/apk/release/app-release.apk

# 2. Rename for distribution
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk kuwaitpetrolpump-v1.0.0.apk

# 3. Upload to server (optional)
scp kuwaitpetrolpump-v1.0.0.apk root@64.226.65.80:/var/www/html/downloads/

# 4. Or share directly
# - WhatsApp to operators
# - USB transfer
# - Email attachment
```

---

## Testing Checklist

### Backend API Tests

```bash
# Health check
curl https://kuwaitpos.duckdns.org/api/health

# Login
curl -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@test.com","password":"password123"}'

# Should return access_token
```

### Web Dashboard Tests

1. Open https://kuwaitpos.duckdns.org
2. Login with operator@test.com / password123
3. Check dashboard loads
4. Test navigation (all routes work)
5. Try offline mode (disconnect internet → UI shows offline badge)

### Mobile App Tests

1. Install APK on Android device
2. Login with operator@test.com / password123
3. Test OCR:
   - Take photo of meter
   - Verify OCR extracts value
   - Submit reading
4. Test manual entry:
   - Select nozzle
   - Enter 7-digit value
   - Submit
5. Test back-dated entry:
   - Toggle ON
   - Select past date
   - Submit
6. Check history shows all readings

---

## Rollback Plan (If Issues)

### Backend Rollback
```bash
ssh root@64.226.65.80
cd ~/kuwait-pos
git checkout <previous-commit-sha>
docker compose -f docker-compose.prod.yml up -d --build backend
```

### Web Rollback
```bash
# Keep backup of previous dist/
ssh root@64.226.65.80
cd ~/kuwait-pos/apps/web
mv dist dist-backup
mv dist-old dist
docker compose -f docker-compose.prod.yml restart nginx
```

### Mobile Rollback
- Distribute previous APK version to users
- Users uninstall new version → install old version

---

## Post-Deployment

### 1. Monitor Logs
```bash
# Backend logs
ssh root@64.226.65.80
docker compose -f docker-compose.prod.yml logs -f backend

# nginx logs
docker compose -f docker-compose.prod.yml logs -f nginx
```

### 2. Database Backup
```bash
ssh root@64.226.65.80
docker exec kuwait-postgres pg_dump -U postgres kuwait_pos > backup-$(date +%Y%m%d).sql
```

### 3. Performance Check
```bash
# Check container resources
docker stats

# Check response times
curl -w "@curl-format.txt" -o /dev/null -s https://kuwaitpos.duckdns.org/api/health
```

---

## Success Criteria

### Backend ✓
- [ ] Health endpoint returns 200
- [ ] Login works
- [ ] API endpoints respond correctly
- [ ] Database connections stable
- [ ] No error logs

### Web ✓
- [ ] HTTPS loads without cert errors
- [ ] Login works
- [ ] Dashboard displays data
- [ ] All routes accessible
- [ ] Offline mode works

### Mobile ✓
- [ ] APK installs on Android
- [ ] Login works
- [ ] OCR captures meter readings
- [ ] Manual entry works
- [ ] Back-dated entry works
- [ ] History displays correctly

---

## Client Handover

### Documentation to Provide
1. ✅ User login credentials
2. ✅ Web dashboard URL
3. ✅ Mobile APK file
4. ✅ Quick start guide
5. ✅ Admin credentials (for QuickBooks setup later)

### Training Required
- **Web Dashboard**: Manager/cashier (15 min)
- **Mobile App**: Operators (10 min)
- **QuickBooks Integration**: Accountant (30 min - later)

---

## Next Phase (After Initial Deployment)

1. **Week 1**: Monitor usage, fix bugs
2. **Week 2**: Collect feedback, optimize
3. **Week 3**: Add QuickBooks integration
4. **Week 4**: Scale to additional pumps

---

**Status**: Ready for deployment once mobile APK build completes.
