# Mobile Build Rescue - Baseline & Root Cause Analysis
**Date**: 2026-04-01
**Branch**: build-rescue
**Status**: BLOCKED - Critical issues identified

---

## 🔴 CRITICAL BLOCKERS IDENTIFIED

### 1. Java NOT Installed (Build Blocker)
**Impact**: Cannot run ANY local Android builds
**Evidence**:
```bash
$ ./gradlew --version
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
```

**Required**:
- Java Development Kit (JDK) 17 or 21 (for Android Gradle Plugin 8.x)
- JAVA_HOME environment variable configured

---

### 2. Claude API Key Exposed (SECURITY BREACH)
**Location**: `apps/mobile/eas.json:21`
**Exposed Key**: `sk-ant-api03-mmeuJ...` (REDACTED - but visible in repo)

**Risk**:
- ❌ Key hardcoded in version control
- ❌ Anyone with repo access can extract and use the key
- ❌ APK decompilation will reveal the key
- ❌ No backend rate limiting or usage controls

**Impact**: Potential unauthorized Claude API usage, billing fraud

---

### 3. Architecture Anti-Pattern (Security + Reliability)
**Current**: Mobile app → Claude API (direct)
**Problem**:
- Mobile holds API key (insecure)
- No backend rate limiting
- No caching or cost optimization
- No audit trail

**Required**: Mobile app → Backend OCR endpoint → Claude API

---

## 📊 VERSION BASELINE

### System Environment
| Component | Version | Status |
|-----------|---------|--------|
| **Node.js** | v22.19.0 | ✅ OK |
| **npm** | 11.6.0 | ✅ OK |
| **Java** | NOT INSTALLED | 🔴 BLOCKER |
| **JAVA_HOME** | NOT SET | 🔴 BLOCKER |

### Mobile Stack
| Component | Version | Notes |
|-----------|---------|-------|
| **Expo CLI** | 0.17.13 | ✅ OK |
| **Expo SDK** | ~50.0.0 | ✅ Latest stable |
| **React Native** | 0.73.2 | ✅ Compatible with SDK 50 |
| **React** | 18.2.0 | ✅ OK |
| **TypeScript** | ^5.3.3 | ✅ OK |

### Android Tooling (After Java Install)
| Component | Version | Status |
|-----------|---------|--------|
| **Gradle** | TBD | ⏳ Requires Java |
| **Android Gradle Plugin** | TBD | ⏳ Requires Java |
| **Android SDK** | TBD | ⏳ Requires Android Studio |

### Package Manager
- **Current**: pnpm (monorepo mode)
- **Issue**: May conflict with Expo build expectations
- **Test Required**: Build with npm/yarn isolation

---

## 🔍 BUILD FAILURE ANALYSIS

### EAS Cloud Builds (5/5 Failed)
**Symptom**: Metro bundler stage failures
**Potential Causes**:
1. pnpm workspace resolution conflicts
2. Missing peer dependencies
3. Expo SDK 50 + monorepo edge case

**Evidence**: No error logs saved (need to reproduce)

### Local Gradle Builds (3/3 Failed)
**Symptom**: Expo plugin dependency resolution
**Root Cause**: Java not installed (confirmed above)

**Fix**: Install JDK 17/21 + set JAVA_HOME

---

## 📁 CURRENT STATE

### Mobile App Structure
```
apps/mobile/
├── android/          ✅ EXISTS (expo prebuild already run)
│   ├── .gradle/      ✅ Gradle cache exists
│   ├── app/          ✅ App module exists
│   ├── build.gradle  ✅ Project-level build script
│   └── gradlew       ✅ Gradle wrapper (needs Java)
├── src/
│   ├── api/
│   │   ├── client.ts       ✅ Backend API client
│   │   └── ocr.ts          🔴 SECURITY ISSUE - calls Claude directly
│   ├── screens/            ✅ All 5 screens implemented
│   └── types/              ✅ TypeScript definitions
├── app.json          ✅ Expo config (valid)
├── eas.json          🔴 CONTAINS API KEY
├── package.json      ✅ Dependencies OK
└── tsconfig.json     ✅ TypeScript config OK
```

### Code Validation
```bash
✅ metro export works (app code is valid)
✅ TypeScript compiles with no errors
✅ All dependencies installed
🔴 Build tooling blocked by Java
```

---

## 🧬 ROOT CAUSE SUMMARY

### Primary Blocker
**Java not installed** → Cannot run `gradlew` → Cannot build APK locally

### Secondary Issues
1. **Security**: API key in eas.json + mobile app
2. **Architecture**: Mobile should NOT call Claude API directly
3. **Tooling**: May need to isolate from pnpm monorepo for build

### Build Path Uncertainty
- **EAS Cloud**: Failing (Metro bundler - cause unknown)
- **Local Gradle**: Failing (Java missing - cause known)
- **Monorepo**: May be contributing to both failures

---

## ✅ DETERMINISTIC BUILD PLAN

### Phase 1: Fix Security (IMMEDIATE)
1. **Rotate exposed API key** (generate new Claude API key)
2. **Remove key from eas.json** (delete lines 20-23)
3. **Create backend OCR endpoint** (`POST /api/meter-readings/ocr`)
4. **Update mobile to use backend** (remove `src/api/ocr.ts` Claude integration)

### Phase 2: Install Build Dependencies
1. **Install JDK 17** (OpenJDK or Oracle)
   - Download: https://adoptium.net/ (Temurin 17 LTS)
   - Add JAVA_HOME to PATH
   - Verify: `java -version` && `javac -version`

2. **Install Android Studio** (if not present)
   - Download SDK tools
   - Accept licenses: `sdkmanager --licenses`

### Phase 3: Isolate Build from Monorepo
1. **Create standalone mobile directory**:
   ```bash
   mkdir build-isolated
   cp -r apps/mobile/src build-isolated/
   cp apps/mobile/{package.json,app.json,tsconfig.json} build-isolated/
   cd build-isolated
   ```

2. **Use npm (not pnpm)** for clean dependency resolution:
   ```bash
   npm install  # Fresh lockfile
   npx expo prebuild --clean  # Regenerate android/
   ```

3. **Build release APK**:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

### Phase 4: Validate & Harden
1. **Manual meter submit test** (1 end-to-end)
2. **OCR submit test** (1 end-to-end via backend)
3. **Verify DB persistence** (check backend logs + database)
4. **Verify history display** (readings show in mobile app)

### Phase 5: Document & Commit
1. **Create BUILD.md runbook** (exact commands, versions, gotchas)
2. **Update .gitignore** (exclude API keys, build artifacts)
3. **Commit security fixes** (backend OCR endpoint + mobile changes)
4. **Tag working build** (`git tag v1.0.0-release`)

---

## 📝 NEXT ACTIONS (Strict Order)

### STOP:
- ❌ No more random EAS build retries
- ❌ No more Gradle attempts without Java
- ❌ No commits with API keys

### START:
1. **Install Java JDK 17** (15 minutes)
2. **Rotate Claude API key** (5 minutes)
3. **Build backend OCR endpoint** (30 minutes)
4. **Test backend OCR** (10 minutes)
5. **Update mobile to use backend** (20 minutes)
6. **Attempt isolated npm build** (first run: 10 minutes)
7. **If successful → document runbook** (15 minutes)
8. **If fails → capture logs and debug** (iterative)

---

## 🎯 DEFINITION OF DONE

### Build Success Criteria
- [ ] One reproducible APK build from clean checkout
- [ ] BUILD.md runbook exists with exact commands
- [ ] APK installs on Android device
- [ ] Login succeeds
- [ ] Manual meter submit works (1 E2E test)
- [ ] OCR meter submit works (1 E2E test via backend)

### Security Criteria
- [ ] No API keys in version control
- [ ] Claude API key rotated
- [ ] Mobile uses backend OCR endpoint only
- [ ] Backend has rate limiting (50/day per user)

### Documentation Criteria
- [ ] BUILD.md: Exact versions, commands, prerequisites
- [ ] Root cause documented (this file)
- [ ] Files changed listed
- [ ] Evidence of working build (screenshots, logs)

---

## 🔐 SECURITY REMEDIATION REQUIRED

### Immediate Actions
1. **Rotate API Key**:
   ```bash
   # Login to console.anthropic.com
   # Revoke: sk-ant-api03-mmeuJ997MYPJKu9rLV...
   # Generate new key
   # Add to backend .env only
   ```

2. **Remove from mobile**:
   ```bash
   git rm apps/mobile/eas.json  # Delete and recreate without key
   # Add eas.json to .gitignore
   ```

3. **Backend OCR Endpoint**:
   ```typescript
   // apps/backend/src/modules/meter-readings/ocr.controller.ts
   POST /api/meter-readings/ocr
   - Accept: multipart/form-data (image file)
   - Rate limit: 50 requests/day per user
   - Return: { extractedValue, confidence, rawText }
   - Log usage to audit trail
   ```

---

## 📦 DELIVERABLES

### Files to Create
1. `BUILD.md` - Reproducible build runbook
2. `apps/backend/src/modules/meter-readings/ocr.controller.ts` - Backend OCR
3. `.env.example` - Template with CLAUDE_API_KEY placeholder

### Files to Modify
1. `apps/mobile/src/api/ocr.ts` - Remove Claude integration, call backend
2. `apps/mobile/eas.json` - Remove exposed API key
3. `.gitignore` - Add `apps/mobile/eas.json`, `*.env`

### Files to Delete
1. None (preserve history, just remove secrets)

---

## 🧪 TEST PLAN

### Local Build Test
```bash
# Clean slate
cd build-isolated
rm -rf node_modules android ios

# Fresh install
npm install

# Prebuild
npx expo prebuild --clean --platform android

# Build
cd android && ./gradlew assembleRelease

# Verify APK
ls -lh app/build/outputs/apk/release/app-release.apk
```

### Functional Tests (On Device)
1. **Login**: operator@test.com / password123
2. **Manual Submit**:
   - Select nozzle
   - Select shift
   - Enter reading: 1234567.89
   - Submit → Success
   - Verify history shows reading

3. **OCR Submit**:
   - Take meter photo
   - Backend extracts value
   - Review + submit
   - Verify history shows reading with OCR badge

---

## 📌 KEY REMINDERS

1. **NEVER commit API keys** - Use .env + .gitignore
2. **ALWAYS rotate exposed keys** - Security incident response
3. **Backend for sensitive operations** - Mobile should never hold secrets
4. **One build path at a time** - Local Gradle first, then consider EAS
5. **Document as you go** - BUILD.md writes itself during the process

---

**Status**: Baseline complete. Ready to execute Phase 1 (Security fixes).
