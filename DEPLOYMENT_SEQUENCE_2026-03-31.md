# Production Deployment Sequence - 2026-03-31

## Path A: Mobile First → Web → Desktop

**Objective**: Get to client deployment ASAP

---

## Phase 1: Mobile App Production ⏳ IN PROGRESS

### Step 1: Build Production APK
```bash
cd apps/mobile
eas build --profile production --platform android
```

**Output**: `kuwaitpetrolpump-v1.0.0.apk`

**Distribution**: WhatsApp/USB to operators

---

## Phase 2: Backend Production Deployment

### Step 1: Commit Current Code
```bash
git add .
git commit -m "feat: mobile OCR + 7-digit validation + back-dated entry + closing validation"
git push origin chore/web-p0-postdeploy-revalidation-2026-03-30
```

### Step 2: Deploy to 64.226.65.80
```bash
ssh root@64.226.65.80
cd ~/kuwait-pos
git pull
docker compose -f docker-compose.prod.yml up -d --build backend
```

---

## Phase 3: Web Dashboard Production

### Step 1: Build
```bash
cd apps/web
npm run build
```

### Step 2: Deploy
```bash
scp -r dist root@64.226.65.80:~/kuwait-pos/apps/web/
ssh root@64.226.65.80 "docker compose -f docker-compose.prod.yml up -d --force-recreate nginx"
```

### Step 3: Test
- Open https://kuwaitpos.duckdns.org
- Login → Dashboard → Test key features

---

## Phase 4: Desktop App (Later)

### Step 1: Fix Build Error
- Issue: `index.html file is not found in /src/renderer directory`
- Fix: Update `electron.vite.config.ts` with correct input path

### Step 2: Build Windows Executable
```bash
cd apps/desktop
npm run build
npm run package:win
```

**Output**: `dist/Kuwait Petrol POS Setup.exe`

### Step 3: Distribute
- Copy `.exe` to USB or share via network
- Install on cashier PCs at petrol pump

---

## Real-Time Changes Workflow

**When you make changes**:

| Change Type | Test Locally | Deploy to Production |
|-------------|--------------|---------------------|
| **Mobile code** | Reload Expo | `eas build` → New APK |
| **Backend code** | Restart dev server | `git pull && docker compose up -d --build backend` |
| **Web code** | Vite hot reload | `npm run build && scp && nginx restart` |
| **Desktop code** | `npm run dev` | `npm run package:win` → New `.exe` |

---

## Success Criteria

### Mobile Production Ready ✓
- [ ] APK downloads successfully
- [ ] Installs on Android device
- [ ] Login works
- [ ] OCR captures meter reading
- [ ] Submits reading to backend
- [ ] History shows submitted readings

### Web Production Ready ✓
- [ ] HTTPS loads without errors
- [ ] Login works
- [ ] Dashboard shows data
- [ ] All routes accessible
- [ ] Offline queue tested

### Backend Production Ready ✓
- [ ] All containers healthy
- [ ] API responds to requests
- [ ] Database accessible
- [ ] JWT auth working

### Desktop Production Ready (Later) ✓
- [ ] `.exe` installs on Windows
- [ ] Login works
- [ ] Fuel sales records transactions
- [ ] Offline queue works
- [ ] Receipt prints (if printer connected)

---

## Current Status (2026-03-31)

**Backend**: ✅ Running on 64.226.65.80 (10+ hours uptime)
**Web**: ✅ Deployed to production
**Mobile**: ⏳ Building production APK now
**Desktop**: ⏸️ Deferred (build broken, fix later)

---

**NEXT ACTION**: Start mobile production APK build with EAS
