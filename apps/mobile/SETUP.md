# Mobile App Setup Guide

## Prerequisites

- Node.js 18+ installed
- npm or pnpm package manager
- Expo CLI (`npm install -g expo-cli`)
- For iOS: macOS with Xcode
- For Android: Android Studio with SDK

## Step 1: Install Dependencies

```bash
cd apps/mobile
pnpm install
```

## Step 2: Configure Environment

Create `.env` file:

```bash
API_URL=http://localhost:8000/api/v1
CLAUDE_API_KEY=your-claude-api-key-here
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

For production, use your actual backend URL:
```bash
API_URL=https://api.kuwaitpetrolpump.com/api/v1
```

## Step 3: Start Development Server

```bash
# Start Expo dev server
pnpm start

# Or start with specific platform
pnpm android   # For Android
pnpm ios       # For iOS
```

## Step 4: Run on Device/Emulator

### Option A: Expo Go App (Easiest)

1. Install Expo Go on your phone:
   - iOS: https://apps.apple.com/app/expo-go/id982107779
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent

2. Scan QR code from terminal with:
   - iOS: Camera app
   - Android: Expo Go app

### Option B: Android Emulator

1. Open Android Studio
2. Create/start an AVD (Android Virtual Device)
3. Run: `pnpm android`

### Option C: iOS Simulator (macOS only)

1. Install Xcode from App Store
2. Run: `pnpm ios`

## Step 5: Test Camera Functionality

Camera won't work on Expo Go or simulators. To test camera:

### Option 1: Development Build

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Create development build
eas build --profile development --platform android
# or
eas build --profile development --platform ios

# Install build on physical device
```

### Option 2: Local Build

```bash
# Android
npx expo run:android

# iOS (macOS only)
npx expo run:ios
```

## Step 6: Testing OCR

1. Login with credentials:
   - Email: admin@example.com
   - Password: admin123

2. Navigate to Dashboard
3. Tap "Capture Meter Reading"
4. Grant camera permission
5. Take photo of meter
6. Review OCR extraction
7. Submit reading

## Common Issues

### Issue: Camera Permission Denied

**Solution:**
- Android: Settings > Apps > Kuwait Petrol Pump > Permissions > Camera
- iOS: Settings > Kuwait Petrol Pump > Camera

### Issue: OCR API Fails

**Solution:**
1. Check internet connection
2. Verify CLAUDE_API_KEY is correct
3. Check Claude API quota/limits
4. Try manual entry as fallback

### Issue: Cannot Connect to Backend

**Solution:**
1. Verify backend is running: `curl http://localhost:8000/api/v1/health`
2. For physical device testing, use your computer's IP:
   ```bash
   API_URL=http://192.168.1.100:8000/api/v1
   ```
3. Ensure firewall allows connections
4. Check network is same for phone and computer

### Issue: Module Not Found

**Solution:**
```bash
# Clear Metro cache
npx expo start --clear

# Or reinstall
rm -rf node_modules
pnpm install
```

### Issue: Build Fails

**Solution:**
```bash
# Clear all caches
npx expo start --clear
rm -rf node_modules
rm -rf .expo
pnpm install
```

## Development Workflow

1. **Start Backend**: Ensure API is running on port 8000
2. **Start Mobile**: Run `pnpm start` in mobile directory
3. **Hot Reload**: Edit files, app reloads automatically
4. **Debug**: Shake device or press `m` in terminal for menu
5. **Logs**: Check terminal for errors and console.log output

## API Configuration

### Development (Local)

```bash
# .env
API_URL=http://localhost:8000/api/v1
```

For physical device, use computer IP:
```bash
# Get your IP
# macOS/Linux: ifconfig | grep inet
# Windows: ipconfig

API_URL=http://192.168.1.100:8000/api/v1
```

### Production

```bash
# .env.production
API_URL=https://api.kuwaitpetrolpump.com/api/v1
```

## Building for Production

### Android APK

```bash
# Using EAS
eas build --platform android

# Or local
npx expo run:android --variant release
```

### iOS IPA

```bash
# Using EAS (requires Apple Developer account)
eas build --platform ios

# Or local (macOS only)
npx expo run:ios --configuration Release
```

## Deployment

### Over-The-Air (OTA) Updates

```bash
# Publish update
eas update --branch production

# Users get update on next app restart
```

### App Store Submission

1. Build production app
2. Create app listing in App Store Connect / Google Play Console
3. Upload build
4. Submit for review
5. Wait for approval (1-7 days)

## Environment-Specific Configs

### Development
- Hot reload enabled
- Debug mode
- Local API (localhost or LAN IP)

### Staging
- No hot reload
- Debug logs enabled
- Staging API URL

### Production
- Optimized build
- No debug logs
- Production API URL
- Error reporting (Sentry)

## Testing Checklist

Before releasing, test:

- [ ] Login/logout flow
- [ ] Camera capture on physical device
- [ ] OCR extraction with clear meter image
- [ ] OCR extraction with blurry image (should fail gracefully)
- [ ] Manual meter reading entry
- [ ] Form validation (empty fields, invalid numbers)
- [ ] Offline mode (airplane mode)
- [ ] Sync after coming back online
- [ ] Readings history with filters
- [ ] Settings (user info, sync status)
- [ ] Logout and login again
- [ ] Remember me checkbox
- [ ] Different user roles

## Performance Optimization

1. **Image Compression**: Already implemented at 0.9 quality
2. **Query Caching**: React Query with 30s stale time
3. **Lazy Loading**: Screens loaded on navigation
4. **Memo Components**: Use React.memo for expensive renders
5. **Bundle Size**: Monitor with `npx expo-doctor`

## Monitoring & Analytics

Add analytics (optional):

```bash
pnpm add @react-native-firebase/analytics
# or
pnpm add expo-analytics
```

Add error tracking:

```bash
pnpm add @sentry/react-native
```

## Security Considerations

1. **API Key**: Never commit .env file
2. **Token Storage**: Using secure AsyncStorage
3. **HTTPS**: Always use HTTPS in production
4. **Certificate Pinning**: Consider for high security
5. **Biometric Auth**: Implement for production

## Next Steps

1. Test all features thoroughly
2. Add error tracking (Sentry)
3. Implement analytics
4. Add biometric authentication
5. Set up CI/CD pipeline
6. Create app store assets (screenshots, descriptions)
7. Submit to app stores
8. Plan OTA update strategy

## Support

For help:
- Check logs in terminal
- Use React Native Debugger
- Check Expo documentation: https://docs.expo.dev
- Contact development team

## Resources

- Expo Docs: https://docs.expo.dev
- React Navigation: https://reactnavigation.org
- React Query: https://tanstack.com/query
- Claude API: https://docs.anthropic.com
