# Mobile APK Local Build Guide - Kuwait Petrol Pump

**Status**: Ready to build locally (bypasses EAS cloud build issues)

---

## Quick Overview

**Why Local Build?**
- ✅ EAS cloud builds keep failing (Gradle/Metro bundler issues)
- ✅ Local export works perfectly (tested and confirmed)
- ✅ Faster iteration (2-3 min rebuilds after first time)
- ✅ No cloud build queue waits
- ✅ Full control over build environment

**Time Investment**:
- First time: 30-40 min (Android Studio install + first build)
- Subsequent builds: 2-5 min

---

## Phase 1: Install Android Studio (One-Time, ~30 min)

### Step 1: Download
- Open: https://developer.android.com/studio
- Click "Download Android Studio"
- Size: ~1 GB installer
- Wait: 5-10 min download

### Step 2: Install
1. Run installer (`android-studio-*-windows.exe`)
2. **Settings**:
   - ✅ Install Type: **Standard**
   - ✅ Check "Android Virtual Device" (AVD)
   - ✅ Accept all licenses (multiple prompts)
3. Let it download Android SDK (~4 GB, 15-20 min)
4. Finish installation

### Step 3: Configure PATH
**After installation completes:**

1. Close all terminals
2. Open PowerShell as Administrator
3. Run:
   ```powershell
   cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump"
   .\setup-android-path.ps1
   ```
4. Restart terminal

**Verify**:
```bash
adb --version
# Should show: Android Debug Bridge version X.X.X
```

---

## Phase 2: Build APK (First Time, ~10 min)

### Step 1: Prepare Project
```bash
cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump\apps\mobile"

# Accept Android licenses (one-time)
sdkmanager --licenses
# Type 'y' for each license
```

### Step 2: Build APK
```bash
# Simple method (recommended):
npx expo run:android --variant release

# Or use the build script:
bash ../../build-mobile-apk.sh
```

**What happens:**
1. Expo generates Android project (prebuild)
2. Gradle builds release APK
3. APK created at: `android/app/build/outputs/apk/release/app-release.apk`
4. **First build**: 8-10 minutes
5. **Subsequent builds**: 2-3 minutes

### Step 3: Find Your APK
```bash
# APK location:
apps/mobile/android/app/build/outputs/apk/release/app-release.apk

# Or copied to root:
kuwaitpetrolpump-v1.0.0.apk
```

---

## Phase 3: Install on Device

### Method A: USB Transfer
1. Connect Android device to PC (USB cable)
2. Copy APK to device
3. On device: Open APK file → Install
4. Allow "Install from unknown sources" if prompted

### Method B: Upload to Server
```bash
# Upload to production server:
scp kuwaitpetrolpump-v1.0.0.apk root@64.226.65.80:/var/www/html/downloads/

# Operators download from:
http://64.226.65.80/downloads/kuwaitpetrolpump-v1.0.0.apk
```

### Method C: Email/WhatsApp
1. Attach APK to email/WhatsApp
2. Send to operators
3. They download and install

---

## Phase 4: Test on Device

### Login
- Email: `operator@test.com`
- Password: `password123`

### Test Checklist
- [ ] Login works
- [ ] Dashboard loads
- [ ] Camera opens
- [ ] OCR extracts meter reading
- [ ] Manual entry form works
- [ ] Submit reading succeeds
- [ ] History shows submitted readings
- [ ] Back-dated entry works
- [ ] 7-digit validation works

---

## Future Updates Workflow

**When you make code changes:**

1. Edit code in `apps/mobile/src/`
2. Run build command:
   ```bash
   npx expo run:android --variant release
   ```
3. APK rebuilds (2-3 min)
4. Distribute new APK to users

**Or use Expo Updates** (OTA - no rebuild needed):
```bash
# After installing expo-updates:
eas update --branch production
# Users get update on next app launch (no APK needed)
```

---

## Troubleshooting

### "adb not found"
- Run `setup-android-path.ps1` again
- Restart terminal
- Check Android Studio installed SDK to default location

### "sdkmanager not found"
- Android Studio didn't install command-line tools
- Open Android Studio → SDK Manager → SDK Tools → Check "Android SDK Command-line Tools"

### "Gradle build failed"
```bash
# Clean build:
cd apps/mobile/android
./gradlew clean
cd ..
npx expo run:android --variant release
```

### "Metro bundler error"
```bash
# Clear Metro cache:
npx expo start --clear
# Then rebuild
```

### First build very slow
- Normal! First build downloads dependencies (~5-8 min)
- Subsequent builds: 2-3 min

---

## Build Size Optimization (Optional)

**Current APK**: ~40-60 MB
**Optimized**: ~20-30 MB

**To optimize:**
```bash
# In apps/mobile/android/app/build.gradle, enable:
def enableProguardInReleaseBuilds = true
def enableSeparateBuildPerCPUArchitecture = true
```

---

## Production Deployment Plan

### For 1 Petrol Pump (Current)
- ✅ Build APK locally
- ✅ Install via USB or WhatsApp
- ✅ Test on-site

### For 10-100 Pumps (Next Phase)
- Upload APK to server
- Operators download from link
- Version management spreadsheet

### For 1000 Pumps (Scale)
- Google Play Store (internal testing track)
- Auto-updates
- Staged rollouts

---

## Current Status

**Android Studio**: ⏳ Installing (you're doing this now)
**Build Script**: ✅ Ready (`build-mobile-apk.sh`)
**PATH Setup**: ✅ Ready (`setup-android-path.ps1`)
**APK Build**: ⏳ Waiting for Android Studio

---

## Next Steps (After Android Studio Installs)

1. ✅ Run `setup-android-path.ps1`
2. ✅ Restart terminal
3. ✅ Run `npx expo run:android --variant release`
4. ✅ Wait 8-10 min (first build)
5. ✅ Get `kuwaitpetrolpump-v1.0.0.apk`
6. ✅ Install on device
7. ✅ Test!
8. ✅ Deploy backend + web to production
9. ✅ Ship to client! 🚀

---

**Once Android Studio finishes, come back and we'll build the APK together!**
