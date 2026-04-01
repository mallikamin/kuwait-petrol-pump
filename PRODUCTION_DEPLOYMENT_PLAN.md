# Production Deployment Plan — Network & Testing

## 📱 Current Setup vs Production

### **Current (Development/Testing)**
```
┌─────────────────────────────────────────────────────┐
│                  Home Wi-Fi Network                  │
│                   (192.168.1.x)                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  💻 Laptop (192.168.1.4)                            │
│  ├── Backend API: http://192.168.1.4:8001/api      │
│  ├── Metro Bundler: exp://192.168.1.4:8081          │
│  └── Database: PostgreSQL (Docker)                  │
│                                                      │
│  📱 Mobile Device (192.168.1.3)                     │
│  ├── Expo Go / Dev Build                            │
│  └── Direct LAN connection to laptop                │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Key Points**:
- ✅ Both devices on **same Wi-Fi**
- ✅ Direct connection (no internet required)
- ✅ Fast development/testing
- ❌ Only works on local network
- ❌ Cannot access from outside

---

### **Production (Deployed)**
```
┌──────────────────────────────────────────────────────────┐
│                    INTERNET                               │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
                          │ HTTPS
                          │
┌─────────────────────────┴─────────────────────────────────┐
│                                                            │
│  🌍 DigitalOcean Droplet (64.226.65.80)                  │
│  🌐 Domain: kuwaitpos.duckdns.org                         │
│                                                            │
│  ┌──────────────────────────────────────────────┐        │
│  │  🔒 Nginx (HTTPS Reverse Proxy)             │        │
│  │  └─ Let's Encrypt SSL Certificate            │        │
│  └──────────────────────────────────────────────┘        │
│         │                                                  │
│         ▼                                                  │
│  ┌──────────────────────────────────────────────┐        │
│  │  🐳 Docker Containers                        │        │
│  │  ├─ Backend API (Node.js + Express)          │        │
│  │  ├─ PostgreSQL Database                      │        │
│  │  ├─ Redis Cache                               │        │
│  │  └─ Web Dashboard (React SPA)                 │        │
│  └──────────────────────────────────────────────┘        │
│                                                            │
└────────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTPS API Calls
                          │
              ┌───────────┴───────────┐
              │                       │
         📱 Operator 1           📱 Operator 2
         (Kuwait Office)        (On-site)
         Wi-Fi/4G               4G/5G
```

---

## 🔌 Production Connection Mechanism

### **How Mobile App Connects in Production**:

1. **Mobile App Configuration**:
   ```typescript
   // apps/mobile/.env.production
   API_URL=https://kuwaitpos.duckdns.org/api
   CLAUDE_API_KEY=sk-ant-api03-...
   CLAUDE_MODEL=claude-sonnet-4-5-20250929
   ```

2. **Network Flow**:
   ```
   📱 Mobile App
   ↓ (Makes API call)
   ↓ https://kuwaitpos.duckdns.org/api/meter-readings
   ↓
   🌍 Internet (4G/5G/Wi-Fi)
   ↓
   🌐 DuckDNS (Resolves to 64.226.65.80)
   ↓
   🔒 Nginx on Droplet (SSL Termination)
   ↓
   🐳 Backend Container (Port 3000 internal)
   ↓
   🗄️ PostgreSQL Database
   ```

3. **Authentication**:
   - Mobile sends JWT token in header: `Authorization: Bearer {token}`
   - Backend validates token
   - Returns data or error

4. **Image Upload**:
   - Mobile captures photo
   - Converts to base64 (~1-2MB)
   - Sends to API via HTTPS (encrypted)
   - Backend saves to `uploads/meter-readings/`
   - Returns success + reading ID

---

## 🏢 Production Setup Requirements

### **Server (DigitalOcean Droplet)**:
✅ Already provisioned: 64.226.65.80
✅ Already configured: Docker + nginx + SSL
✅ Already running: Backend + Database + Redis

### **Mobile App Deployment**:

#### **Option A: Standalone APK (Recommended)**
```bash
# Build APK with production API URL
cd apps/mobile
eas build --profile production --platform android

# Result: Download APK file
# Install on operator devices via:
# - USB transfer
# - Google Drive link
# - Email attachment
```

**Pros**:
- ✅ No Expo Go dependency
- ✅ Works offline (syncs when online)
- ✅ Professional app icon
- ✅ Can be installed on unlimited devices

**Cons**:
- ⏱️ Takes ~15-20 minutes to build
- 💰 Requires EAS account (free tier available)

#### **Option B: Internal Distribution**
- Build APK locally
- Share via internal server
- No Google Play Store needed

---

## 🌐 Network Scenarios in Production

### **Scenario 1: Office Wi-Fi**
```
📱 Operator at office
↓ Office Wi-Fi
↓ Internet
↓ Server (64.226.65.80)
```
- **Speed**: Fast (~10-50 Mbps)
- **Latency**: Low (~50-100ms)
- **Cost**: Free (office internet)

### **Scenario 2: Mobile Data (4G/5G)**
```
📱 Operator on-site
↓ Mobile carrier (4G/5G)
↓ Internet
↓ Server (64.226.65.80)
```
- **Speed**: Moderate-Fast (~5-20 Mbps)
- **Latency**: Moderate (~100-300ms)
- **Cost**: Data charges apply (~1-2MB per image upload)

### **Scenario 3: Offline → Online Sync**
```
📱 Operator captures reading (no internet)
↓ Saved to local IndexedDB/SQLite
↓ (Waits for internet)
↓ Auto-sync when connected
↓ Server updates database
```
- **Supported**: Yes (offline capability built-in)
- **Queue**: Readings wait in local storage
- **Sync**: Automatic when online

---

## 🧪 Next Testing Steps (After Audit Trail)

### **Test 1: Verify Audit Trail Works**
**Duration**: 5 minutes

**Steps**:
1. **On mobile**: Submit one meter reading with photo
2. **On laptop**: Check uploads directory
   ```bash
   ls apps/backend/uploads/meter-readings/
   # Should show new .jpg file
   ```
3. **Check database**:
   ```bash
   docker exec petrol-pump-postgres psql -U petrolpump -d petrolpump_dev -c "SELECT image_url, is_ocr, ocr_confidence, meter_value FROM meter_readings ORDER BY recorded_at DESC LIMIT 1;"
   ```
4. **View image**: Open in browser
   ```
   http://192.168.1.4:8001/uploads/meter-readings/{filename}
   ```

**Expected**:
- ✅ Image file exists in uploads/
- ✅ Database has imageUrl path
- ✅ Image viewable in browser
- ✅ OCR metadata saved

---

### **Test 2: End-to-End Flow (All Features)**
**Duration**: 15 minutes

**Complete workflow**:
1. **Login** as operator
2. **Capture photo** of meter
3. **OCR extracts** value
4. **Review/correct** if needed
5. **Select** nozzle + shift
6. **Submit**
7. **View history** → See "OCR (95%)" badge
8. **Verify** image saved
9. **Test offline** (airplane mode) → Submit → Goes to queue
10. **Test sync** (back online) → Queue uploads

**Expected**:
- ✅ All steps work without errors
- ✅ Audit trail complete
- ✅ Offline sync functional

---

### **Test 3: Production Deployment Prep**
**Duration**: 30 minutes

**Tasks**:
1. **Build mobile APK**:
   ```bash
   cd apps/mobile
   # Update .env.production with server URL
   eas build --profile production --platform android
   ```

2. **Deploy backend** to server:
   ```bash
   ssh root@64.226.65.80
   cd ~/kuwait-pos
   git pull origin master
   docker compose -f docker-compose.prod.yml up -d --build
   ```

3. **Deploy web** dashboard:
   ```bash
   cd apps/web
   npm run build
   scp -r dist root@64.226.65.80:~/kuwait-pos/apps/web/
   ```

4. **Verify production**:
   - Backend: `https://kuwaitpos.duckdns.org/api/health`
   - Web: `https://kuwaitpos.duckdns.org/`
   - APK: Install on test device → Test login → Test reading

---

## 📋 Production Deployment Checklist

### **Before Deployment**:
- [ ] Test audit trail locally (image saving works)
- [ ] Test offline sync (airplane mode → online)
- [ ] Test OCR accuracy with real meters (5-10 samples)
- [ ] Verify rate limiting (try 51st OCR → should block)
- [ ] Test all user roles (operator, manager, admin)
- [ ] Backup current database
- [ ] Document any issues in ERROR_LOG.md

### **During Deployment**:
- [ ] Build production APK with correct API_URL
- [ ] Deploy backend to 64.226.65.80
- [ ] Deploy web dashboard
- [ ] Run database migrations
- [ ] Create production users (operators)
- [ ] Test one reading from production server
- [ ] Verify audit images saved on server

### **After Deployment**:
- [ ] Install APK on all operator devices
- [ ] Train operators on app usage
- [ ] Monitor first day of readings
- [ ] Check server disk space (for images)
- [ ] Verify backup cron job running
- [ ] Document production URL in docs

---

## 🎯 Summary

### **Current**: Development on local Wi-Fi
- Laptop + Mobile on same network
- Fast iteration and testing
- No internet required

### **Production**: Cloud server with mobile apps
- Mobile → Internet → Server (kuwaitpos.duckdns.org)
- Works from anywhere (office, on-site, home)
- Supports multiple operators simultaneously

### **Next Step**: Test audit trail locally, then deploy!

**Recommended Order**:
1. ✅ Test audit trail (verify image saved) ← **DO THIS NOW**
2. Test offline sync
3. Build production APK
4. Deploy to server
5. Install on operator devices
6. Go live! 🚀
