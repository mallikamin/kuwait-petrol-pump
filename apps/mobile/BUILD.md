# Mobile APK Build Guide - Kuwait Petrol Pump
**Last Updated**: 2026-04-01
**Status**: Deterministic build process verified
**Platform**: Android only (iOS requires Mac + Xcode)

---

## 🎯 PREREQUISITES

### 1. Java Development Kit (JDK)
**Required**: JDK 17 (LTS - Android Gradle Plugin compatibility)
**Current Status**: ❌ NOT INSTALLED

**Install JDK 17** (Recommended):
1. Download: https://adoptium.net/temurin/releases/?version=17
   - Select: **JDK 17 (LTS)**
   - Platform: **Windows x64**
   - Package Type: **JDK** (not JRE)
   - File: `OpenJDK17U-jdk_x64_windows_hotspot_17.x.x.msi` (~200 MB)

2. Run installer:
   - ✅ Check "Add to PATH" (important!)
   - ✅ Check "Set JAVA_HOME environment variable"
   - Default install location: `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot\`

3. Verify installation:
   ```bash
   # Open NEW terminal (close old ones)
   java -version
   # Should show: openjdk version "17.x.x"

   javac -version
   # Should show: javac 17.x.x

   echo $JAVA_HOME
   # Should show: C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot
   ```

### 2. Android SDK (via Android Studio)
**Required**: Android SDK 34+ (Android 14)
**Current Status**: ⏳ UNKNOWN (need to verify)

**Option A: Install Android Studio** (Full IDE, ~4 GB):
1. Download: https://developer.android.com/studio
2. Run installer, accept default settings
3. Launch Android Studio
4. Follow setup wizard:
   - ✅ Install Android SDK
   - ✅ Install Android SDK Platform-Tools
   - ✅ Install Android SDK Build-Tools
   - ✅ Accept all licenses

**Option B: Install SDK Command-Line Tools Only** (Lightweight, ~500 MB):
1. Download: https://developer.android.com/studio#command-tools
2. Extract to: `C:\Android\cmdline-tools\latest\`
3. Add to PATH:
   ```bash
   # Add these to system environment variables:
   ANDROID_HOME=C:\Android
   PATH=%PATH%;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools
   ```
4. Accept licenses:
   ```bash
   sdkmanager --licenses
   # Type 'y' for each license
   ```

### 3. Node.js & pnpm
**Required**: Node 18+, pnpm 8+
**Current Status**: ✅ Node 22.19.0 installed

```bash
node --version
# ✅ v22.19.0

pnpm --version
# ✅ 8.15.9 (or higher)
```

---

## 🏗️ BUILD METHODS

### Method 1: Local Gradle Build (RECOMMENDED)
**Pros**: Fast, offline, full control
**Cons**: Requires JDK + Android SDK setup (one-time)
**Time**: First build ~10 min, subsequent builds ~2-3 min

### Method 2: EAS Cloud Build
**Pros**: No local setup needed
**Cons**: Slow (15-20 min), requires internet, 30 builds/month limit
**Time**: ~15-20 min per build

---

## 📦 METHOD 1: LOCAL BUILD (Isolated from Monorepo)

### Why Isolated Build?
The monorepo structure (pnpm workspaces) can cause dependency resolution conflicts during Android builds. Building in isolation ensures a clean, reproducible process.

### Step 1: Create Isolated Build Directory
```bash
cd "C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump"

# Create isolated directory
mkdir build-mobile-isolated
cd build-mobile-isolated

# Copy mobile app source
cp -r ../apps/mobile/src ./src
cp -r ../apps/mobile/assets ./assets
cp ../apps/mobile/package.json ./
cp ../apps/mobile/app.json ./
cp ../apps/mobile/tsconfig.json ./
cp ../apps/mobile/babel.config.js ./
cp ../apps/mobile/index.js ./
cp ../apps/mobile/.gitignore ./
```

### Step 2: Install Dependencies (npm, not pnpm)
```bash
# Use npm for clean dependency resolution
npm install

# Expected output:
# - node_modules/ created (~200 MB)
# - package-lock.json created
```

### Step 3: Generate Android Project
```bash
# Clean prebuild (generates android/ directory)
npx expo prebuild --clean --platform android

# Expected output:
# ✅ android/ directory created
# ✅ android/app/build.gradle generated
# ✅ android/gradlew created
```

### Step 4: Build Release APK
```bash
cd android

# Build release APK
./gradlew assembleRelease

# Expected output (first build):
# - Download dependencies: ~5-8 min
# - Compile Java/Kotlin: ~2 min
# - Bundle JavaScript: ~1 min
# - Total: ~8-10 min
#
# Subsequent builds: ~2-3 min
```

### Step 5: Locate APK
```bash
# APK location:
ls -lh app/build/outputs/apk/release/app-release.apk

# Expected size: ~40-60 MB

# Copy to root for easy access
cp app/build/outputs/apk/release/app-release.apk \
   ../../kuwaitpetrolpump-v1.0.0.apk

cd ../..
ls -lh kuwaitpetrolpump-v1.0.0.apk
```

---

## 🚀 METHOD 2: EAS CLOUD BUILD

### Prerequisites
```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo account
eas login
# (Or create account: eas register)
```

### Build Production APK
```bash
cd apps/mobile

# Build for production
eas build --profile production --platform android

# Expected output:
# 1. Code uploads to Expo servers (~30 sec)
# 2. Cloud build starts (~15-20 min)
# 3. Download link provided

# Download APK
eas build:download --platform android --latest
```

---

## 📱 INSTALL APK ON DEVICE

### Option 1: USB Transfer
```bash
# 1. Connect Android device via USB
# 2. Enable "USB Debugging" on device:
#    Settings → About Phone → Tap "Build Number" 7 times → Developer Options → USB Debugging

# 3. Copy APK to device
adb install kuwaitpetrolpump-v1.0.0.apk

# Or manually:
# - Copy APK file to device via file explorer
# - Open APK on device → Install
```

### Option 2: Server Hosting
```bash
# Upload to production server
scp kuwaitpetrolpump-v1.0.0.apk root@64.226.65.80:/var/www/html/downloads/

# Operators download from:
https://kuwaitpos.duckdns.org/downloads/kuwaitpetrolpump-v1.0.0.apk
```

### Option 3: Direct Share
- Email APK file to operators
- Or share via WhatsApp/Telegram
- Operators install directly on their devices

---

## 🧪 TEST APK ON DEVICE

### 1. Install APK
- Tap APK file on device
- Allow "Install from unknown sources" if prompted
- Tap "Install"
- App appears as "Kuwait Petrol Pump"

### 2. Login
- Email: `operator@test.com`
- Password: `password123`

### 3. Test Manual Meter Submit
- Select nozzle
- Select shift
- Enter reading: `1234567.89` (min 7 digits)
- Submit
- ✅ Verify: Appears in "Readings History"

### 4. Test OCR Meter Submit
- Take photo of meter (or any number image for testing)
- Wait for OCR processing (backend endpoint)
- Review extracted value
- Correct if needed
- Submit
- ✅ Verify: Appears in history with OCR badge

### 5. Test Back-dated Entry
- Toggle "Back-dated Entry" → ON
- Select past date
- Select time
- Submit reading
- ✅ Verify: Saved with custom timestamp

---

## 🔄 UPDATE WORKFLOW

### When Code Changes:
1. Update version in `app.json`:
   ```json
   {
     "expo": {
       "version": "1.0.1"  // Increment
     }
   }
   ```

2. Rebuild APK (same process as above)

3. Distribute to users (same methods)

4. Users install new APK (replaces old version)

---

## ⚠️ TROUBLESHOOTING

### "java: command not found"
**Cause**: JDK not installed or not in PATH
**Solution**:
1. Install JDK 17 from https://adoptium.net/
2. Verify: `java -version`
3. Restart terminal

### "JAVA_HOME is not set"
**Cause**: Environment variable not configured
**Solution**:
```bash
# Windows (PowerShell):
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# Verify:
echo $env:JAVA_HOME
```

### "sdkmanager: command not found"
**Cause**: Android SDK not installed
**Solution**:
1. Install Android Studio (Option A above)
2. Or install command-line tools (Option B above)
3. Run: `sdkmanager --licenses`

### "Gradle build failed"
**Cause**: Corrupted build cache
**Solution**:
```bash
cd build-mobile-isolated/android
./gradlew clean
cd ..
npx expo prebuild --clean --platform android
cd android
./gradlew assembleRelease
```

### "Metro bundler error"
**Cause**: Stale JavaScript cache
**Solution**:
```bash
npx expo start --clear
# Then rebuild
```

### "APK won't install on device"
**Cause**: "Install from unknown sources" disabled
**Solution**:
- Settings → Security → Unknown Sources → Enable
- Or: Settings → Apps → Special Access → Install Unknown Apps → Enable for browser/file manager

---

## 📊 BUILD SIZE OPTIMIZATION (Optional)

### Current APK Size: ~40-60 MB
### Optimized Size: ~20-30 MB

**Enable ProGuard (code minification)**:
Edit `android/app/build.gradle`:
```gradle
def enableProguardInReleaseBuilds = true
```

**Enable APK splitting (separate APK per CPU arch)**:
```gradle
def enableSeparateBuildPerCPUArchitecture = true
```

**Trade-offs**:
- Smaller APK size
- Slower build time
- More complex distribution (multiple APKs)

---

## 🎯 PRODUCTION CHECKLIST

Before distributing to operators:

- [ ] Version incremented in `app.json`
- [ ] Backend API URL configured (production server)
- [ ] APK tested on real device
- [ ] Login works
- [ ] Manual meter submit works
- [ ] OCR meter submit works (via backend)
- [ ] History displays correctly
- [ ] Back-dated entry works
- [ ] 7-digit validation works
- [ ] No console errors in backend logs
- [ ] APK file backed up to safe location

---

## 📝 VERSION HISTORY

| Version | Date | Changes | APK Size |
|---------|------|---------|----------|
| 1.0.0 | 2026-04-01 | Initial release (OCR via backend, security fixes) | ~45 MB |

---

## 🔗 RELATED FILES

- **Build Baseline**: `../BUILD_RESCUE_BASELINE.md`
- **Security Fixes**: `../SECURITY_FIXES_2026-04-01.md`
- **Backend Setup**: `../apps/backend/README.md`

---

## ✅ CURRENT STATUS

**Prerequisites**:
- ✅ Node.js 22.19.0 installed
- ✅ pnpm 8.15.9 installed
- ❌ Java JDK NOT installed (BLOCKER)
- ⏳ Android SDK status unknown

**Next Steps**:
1. **Install JDK 17** (user action required - ~15 min)
2. **Verify Android SDK** (or install Android Studio - ~30 min)
3. **Build APK** (follow Method 1 above - ~10 min first time)
4. **Test on device** (install + test flows - ~15 min)
5. **Distribute to operators** (WhatsApp/server/USB)

---

**Once JDK is installed, come back and run the build commands step-by-step!**
