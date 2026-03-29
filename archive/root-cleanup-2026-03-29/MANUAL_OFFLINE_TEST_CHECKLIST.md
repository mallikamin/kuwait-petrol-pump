# Manual Offline Testing Checklist
**UI-Level Offline Persistence Validation**

**Purpose**: Validate that offline queue persists across app restarts (browser refresh, Electron restart).
**Why Manual**: Browser DevTools + network disconnect + screenshots require human interaction.

---

## Prerequisites

1. **Backend API running**: `http://64.226.65.80/api` or `https://kuwaitpos.duckdns.org/api`
2. **Valid login credentials**: Username + password
3. **Valid branch ID**: Query from DB or use test branch
4. **Screenshot tool ready**: For capturing evidence

---

## Test 1: Web POS - Browser Offline Persistence

### Setup
1. Open browser (Chrome/Firefox recommended)
2. Navigate to: `http://64.226.65.80` or `https://kuwaitpos.duckdns.org`
3. Login with test credentials
4. Navigate to POS page: `/pos` or `/non-fuel-pos`

### Test Steps

#### Step 1.1: Go Offline (Simulate No Network)
- **Chrome**: DevTools → Network tab → Select "Offline" from throttling dropdown
- **Firefox**: DevTools → Network tab → Toggle "Offline" checkbox
- **Alternative**: Disable Wi-Fi/Ethernet physically

📸 **Screenshot 1**: Browser DevTools showing "Offline" mode enabled

#### Step 1.2: Create Sale While Offline
- Fill out sale form:
  - Customer: "Test Customer" (or select existing)
  - Product/Fuel: Select any product
  - Quantity: 10
  - Payment method: Cash
  - Amount: $50.00
- Click "Save Sale" or "Record Sale"
- **Expected**: Success message: "Sale saved (offline queue)"
- **Expected**: Sync status shows "1 Pending" or "Offline - 1 queued"

📸 **Screenshot 2**: Success message after saving offline sale
📸 **Screenshot 3**: Sync status badge showing "1 Pending"

#### Step 1.3: Create Second Sale While Offline
- Repeat Step 1.2 with different amount ($25.50)
- **Expected**: Success message: "Sale saved (offline queue)"
- **Expected**: Sync status shows "2 Pending"

📸 **Screenshot 4**: Sync status badge showing "2 Pending"

#### Step 1.4: Refresh Browser (Hard Refresh)
- Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- **Expected**: Page reloads
- **Expected**: Sync status STILL shows "2 Pending" (data persisted in IndexedDB)

📸 **Screenshot 5**: After refresh, sync status shows "2 Pending"

✅ **PASS CRITERIA**: Pending count persists across browser refresh (IndexedDB working)

#### Step 1.5: Go Online and Sync
- Re-enable network:
  - Chrome/Firefox: DevTools → Network tab → Select "No throttling" or "Online"
  - Or: Re-enable Wi-Fi/Ethernet
- Click "Sync" button or wait for auto-sync (if implemented)
- **Expected**: Sync in progress indicator
- **Expected**: Success message: "Synced 2 sales"
- **Expected**: Sync status shows "0 Pending" or "Synced ✓"

📸 **Screenshot 6**: Sync success message
📸 **Screenshot 7**: Sync status showing "0 Pending" or "Synced ✓"

#### Step 1.6: Verify in Database
SSH to server and query:
```bash
ssh root@64.226.65.80
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c \
  "SELECT offline_queue_id, sale_type, total_amount, payment_method, sync_status
   FROM sales
   WHERE offline_queue_id LIKE 'manual-test-%'
   ORDER BY created_at DESC
   LIMIT 10;"
```

📸 **Screenshot 8**: Terminal output showing 2 synced sales in DB

✅ **PASS CRITERIA**: Both sales exist in DB with `sync_status = 'synced'`

---

## Test 2: Desktop Electron - Offline Persistence

### Setup
1. Build and run Electron app:
   ```bash
   cd apps/desktop
   npm run dev
   # Or: npm run build && npm run start
   ```
2. Login with test credentials
3. Navigate to Fuel Sales or Non-Fuel POS screen

### Test Steps

#### Step 2.1: Disconnect Network
- **Windows**: Turn off Wi-Fi or disable Ethernet adapter
- **Mac/Linux**: Turn off Wi-Fi or unplug Ethernet
- **Alternative**: Firewall rule to block app

📸 **Screenshot 9**: Network disconnected (OS network settings)

#### Step 2.2: Create Sale While Offline
- Fill out sale form (similar to Web test)
- Click "Save Sale"
- **Expected**: Success message: "Sale saved (offline queue)"
- **Expected**: Sync status shows "1 Pending"

📸 **Screenshot 10**: Electron app showing "1 Pending" sale

#### Step 2.3: Create Second Sale While Offline
- Repeat with different data
- **Expected**: Sync status shows "2 Pending"

📸 **Screenshot 11**: Electron app showing "2 Pending" sales

#### Step 2.4: Restart Electron App
- Close app completely (Cmd+Q / Alt+F4)
- Restart app
- Login again
- **Expected**: Sync status STILL shows "2 Pending" (data persisted in local DB/SQLite)

📸 **Screenshot 12**: After restart, sync status shows "2 Pending"

✅ **PASS CRITERIA**: Pending count persists across app restart (local DB working)

#### Step 2.5: Reconnect Network and Sync
- Re-enable Wi-Fi/Ethernet
- Click "Sync" button or wait for auto-sync
- **Expected**: Sync success message
- **Expected**: Sync status shows "0 Pending"

📸 **Screenshot 13**: Sync success in Electron app

#### Step 2.6: Verify in Database
Same as Test 1 Step 1.6

✅ **PASS CRITERIA**: Both sales exist in DB with `sync_status = 'synced'`

---

## Test 3: Mobile App - Offline Persistence (React Native)

### Setup
1. Build and run mobile app on device/emulator:
   ```bash
   cd apps/mobile
   npx expo start
   # Press 'a' for Android or 'i' for iOS
   ```
2. Login with test credentials
3. Navigate to Meter Reading screen

### Test Steps

#### Step 3.1: Enable Airplane Mode
- **iOS**: Swipe down Control Center → Airplane mode ON
- **Android**: Swipe down Quick Settings → Airplane mode ON

📸 **Screenshot 14**: Phone showing Airplane mode enabled

#### Step 3.2: Capture Meter Photo (Offline)
- Take photo of meter (real meter or printed sample)
- OCR extracts reading
- Verify reading is correct
- Submit reading
- **Expected**: Success message: "Reading saved (offline queue)"
- **Expected**: Sync status shows "1 Pending"

📸 **Screenshot 15**: Mobile app showing "1 Pending" reading

#### Step 3.3: Create Second Meter Reading (Offline)
- Repeat with different meter photo
- **Expected**: Sync status shows "2 Pending"

📸 **Screenshot 16**: Mobile app showing "2 Pending" readings

#### Step 3.4: Restart Mobile App
- Force close app (swipe up on iOS, recent apps on Android)
- Reopen app
- Login again
- **Expected**: Sync status STILL shows "2 Pending" (data persisted in AsyncStorage)

📸 **Screenshot 17**: After restart, sync status shows "2 Pending"

✅ **PASS CRITERIA**: Pending count persists across app restart (AsyncStorage working)

#### Step 3.5: Disable Airplane Mode and Sync
- Disable Airplane mode
- Wait for network to reconnect
- Click "Sync" button or wait for auto-sync
- **Expected**: Sync success message
- **Expected**: Sync status shows "0 Pending"

📸 **Screenshot 18**: Sync success in mobile app

#### Step 3.6: Verify in Database
SSH to server and query:
```bash
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c \
  "SELECT offline_queue_id, meter_value, recorded_by, sync_status
   FROM meter_readings
   WHERE offline_queue_id LIKE 'manual-test-%'
   ORDER BY created_at DESC
   LIMIT 10;"
```

📸 **Screenshot 19**: Terminal output showing 2 synced meter readings in DB

✅ **PASS CRITERIA**: Both meter readings exist in DB with `sync_status = 'synced'`

---

## Test 4: Edge Cases

### Test 4.1: Duplicate Replay Protection
1. Go offline
2. Create 1 sale with offline queue ID: `manual-test-duplicate-check`
3. Go online and sync (sale should sync successfully)
4. Manually replay the same sale (same offline queue ID)
5. **Expected**: Backend returns `duplicates: 1, synced: 0`
6. **Expected**: DB has only 1 sale with that offline_queue_id

📸 **Screenshot 20**: API response showing duplicate detected

### Test 4.2: Offline → Online → Offline → Online
1. Create 1 sale offline → sync online (success)
2. Go offline again → create 1 more sale
3. Go online → sync (both should be synced, no duplicates)
4. **Expected**: DB has 2 sales, both synced

### Test 4.3: Large Offline Queue (Stress Test)
1. Go offline
2. Create 50 sales offline
3. Go online and sync
4. **Expected**: All 50 sales synced successfully
5. **Expected**: Sync completes in < 30 seconds

📸 **Screenshot 21**: Sync progress showing 50/50 synced

---

## Evidence Artifacts

### Required Files (Per Test)
- [ ] Screenshots (at least 8 per test, numbered)
- [ ] DB query results (terminal output or screenshot)
- [ ] Sync API responses (optional: save JSON to file)
- [ ] Test execution notes (date, tester name, environment)

### Evidence Directory Structure
```
manual-test-evidence-YYYYMMDD-HHMMSS/
├── test1-web-offline/
│   ├── 01-offline-mode-enabled.png
│   ├── 02-sale-saved-offline.png
│   ├── 03-sync-status-1-pending.png
│   ├── 04-sync-status-2-pending.png
│   ├── 05-after-refresh-2-pending.png
│   ├── 06-sync-success.png
│   ├── 07-sync-status-0-pending.png
│   └── 08-db-verification.txt
├── test2-desktop-offline/
│   ├── 09-network-disconnected.png
│   ├── 10-electron-1-pending.png
│   ├── ...
├── test3-mobile-offline/
│   ├── 14-airplane-mode-enabled.png
│   ├── 15-mobile-1-pending.png
│   ├── ...
└── test4-edge-cases/
    └── 20-duplicate-detected.png
```

---

## Sign-Off

**Tested By**: ___________________________
**Date**: ___________________________
**Environment**: ___________________________
**Result**: [ ] ✅ PASS  [ ] ❌ FAIL

**Notes**:
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

---

## Automated Alternative (Future)

Once Playwright/Cypress/Appium tests are implemented:
- Web: `npm run test:e2e:web:offline`
- Desktop: `npm run test:e2e:desktop:offline`
- Mobile: `npm run test:e2e:mobile:offline` (Appium + Detox)

**Current Status**: Manual testing required (automated E2E not implemented)
