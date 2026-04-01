#!/bin/bash
# Kuwait Petrol Pump - Mobile APK Local Build Script
# This builds the APK on your local machine (bypasses EAS cloud builds)

set -e  # Exit on error

echo "🚀 Building Kuwait Petrol Pump Mobile APK..."
echo ""

# Navigate to mobile directory
cd "$(dirname "$0")/apps/mobile"

# Check if Android SDK is available
if ! command -v adb &> /dev/null; then
    echo "❌ Android SDK not found!"
    echo "Please install Android Studio and run setup-android-path.ps1"
    exit 1
fi

echo "✓ Android SDK found"
echo ""

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf android/app/build/outputs/apk/
echo "✓ Clean complete"
echo ""

# Prebuild (generate Android native project)
echo "📦 Generating Android project..."
npx expo prebuild --platform android --clean
echo "✓ Prebuild complete"
echo ""

# Build release APK
echo "🔨 Building release APK..."
cd android
./gradlew assembleRelease --no-daemon
cd ..

# Find the APK
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"

if [ -f "$APK_PATH" ]; then
    echo ""
    echo "✅ BUILD SUCCESSFUL!"
    echo ""
    echo "📱 APK Location:"
    echo "   $APK_PATH"
    echo ""

    # Copy to root for easy access
    cp "$APK_PATH" "../../kuwaitpetrolpump-v1.0.0.apk"
    echo "📋 Copied to: kuwaitpetrolpump-v1.0.0.apk"
    echo ""

    # Show file size
    SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo "📦 Size: $SIZE"
    echo ""

    echo "🎉 Ready to install!"
    echo ""
    echo "Next steps:"
    echo "1. Transfer kuwaitpetrolpump-v1.0.0.apk to Android device"
    echo "2. Install on device"
    echo "3. Test the app"
    echo ""
else
    echo ""
    echo "❌ BUILD FAILED!"
    echo "APK not found at expected location"
    exit 1
fi
