# Mobile App Production Build Instructions

## Prerequisites Completed ✅
- ✅ EAS CLI installed globally
- ✅ eas.json configuration created
- ✅ app.json configured with bundle ID and permissions
- ✅ All code changes complete (OCR, validation, back-dated entry)

---

## Step 1: Login to Expo Account

**If you have an Expo account:**
```bash
eas login
# Enter your email and password
```

**If you DON'T have an Expo account:**
```bash
eas register
# Create account with email/password
# Free tier includes 30 builds/month
```

---

## Step 2: Link Project to Expo

```bash
cd apps/mobile
eas build:configure
# Follow prompts:
# - Confirm project slug: kuwait-petrol-pump
# - Confirm bundle identifier: com.kuwaitpetrolpump.app
```

---

## Step 3: Build Production APK

```bash
eas build --profile production --platform android
```

**What happens:**
1. Code uploads to Expo servers (~30 seconds)
2. Cloud build starts (~15-20 minutes)
3. You get a download link when complete

**Output:**
- APK file (~50-100 MB)
- Download link valid for 30 days
- Can download multiple times

---

## Step 4: Download and Test

```bash
# Download from link provided by EAS
# Or download via CLI:
eas build:download --platform android --latest
```

**Transfer to device:**
- Option A: USB cable → copy APK to phone
- Option B: Email/WhatsApp APK to yourself → download on phone
- Option C: Upload to server → operators download from URL

**Install on Android:**
1. Open APK file on phone
2. Allow "Install from unknown sources" if prompted
3. Tap "Install"
4. App appears on home screen: "Kuwait Petrol Pump"

---

## Step 5: Test on Device

### Login
- Email: `operator@test.com`
- Password: `password123`

### Test OCR Flow
1. Dashboard → "Capture Meter Reading"
2. Take photo of meter
3. Wait for OCR processing
4. Verify extracted value
5. Submit reading
6. Check history → reading appears

### Test Manual Entry
1. Dashboard → "Manual Entry"
2. Select nozzle
3. Select shift
4. Enter meter value (≥ 1,000,000)
5. Submit
6. Check history

### Test Back-dated Entry
1. Manual entry form
2. Toggle "Back-dated Entry" ON
3. Select past date + time
4. Submit
5. Verify timestamp in history

---

## Alternative: Local Build (No Cloud)

If EAS is too slow or you prefer local builds:

```bash
# Install Android Studio + SDK
# Enable USB debugging on device

# Build locally
cd apps/mobile
npx expo run:android

# Generates APK in:
# android/app/build/outputs/apk/release/app-release.apk
```

**Pros**: Faster, no cloud dependency
**Cons**: Requires Android Studio setup (~5 GB download)

---

## Troubleshooting

### "Build failed: Missing credentials"
```bash
eas credentials
# Configure Android keystore (auto-generated on first build)
```

### "Bundle identifier conflict"
```bash
# Update app.json:
"android": {
  "package": "com.yourcompany.kuwaitpetrolpump"
}
```

### "Build timeout"
- Expo free tier has 30-minute timeout
- Retry: `eas build --platform android --profile production`

### "APK won't install on device"
- Enable "Install from unknown sources" in Android settings
- Security → Unknown sources → Allow
- Or: Developer options → USB debugging → ON

---

## Cost

**Expo Free Tier:**
- 30 builds/month (enough for development + updates)
- No credit card needed
- Build history saved for 30 days

**Paid Tier** (optional, if you need more builds):
- $29/month for unlimited builds
- Priority build queue
- Longer build history

---

## Production Distribution Options

### Option 1: Direct Share (Easiest)
```bash
# After build completes:
1. Download APK from EAS link
2. WhatsApp to operators
3. They install directly
```

### Option 2: Server Hosting
```bash
# Upload APK to your server:
scp kuwaitpetrolpump-v1.0.0.apk root@64.226.65.80:/var/www/downloads/

# Operators download from:
https://kuwaitpos.duckdns.org/downloads/kuwaitpetrolpump-v1.0.0.apk
```

### Option 3: Google Play Store (Future)
```bash
eas submit --platform android
# Follow prompts to submit to Play Store
# Requires Google Play Developer account ($25 one-time)
# Auto-updates for users
```

---

## Update Workflow (After First Release)

**When you make code changes:**

1. Update version in `app.json`:
   ```json
   {
     "expo": {
       "version": "1.0.1"  // Increment
     }
   }
   ```

2. Build new APK:
   ```bash
   eas build --profile production --platform android
   ```

3. Distribute to users (same methods as above)

4. Users install new APK (replaces old version)

---

## Next Steps

**Do this now:**
```bash
# 1. Login to Expo
eas login

# 2. Build production APK
cd apps/mobile
eas build --profile production --platform android

# 3. Wait 15-20 minutes for build

# 4. Download APK and test on device

# 5. If successful, move to backend deployment
```

**After mobile is verified:**
1. Deploy backend to production (64.226.65.80)
2. Deploy web dashboard
3. Test end-to-end
4. Ship to client!

---

**Current Status**: Ready to build. Just need to run `eas login` and `eas build`.
