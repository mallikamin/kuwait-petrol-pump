# Kuwait Petrol Pump Mobile App

React Native mobile application for meter reading with AI-powered OCR using Claude API.

## Features

### 1. Authentication
- Email/password login
- JWT token storage with AsyncStorage
- Remember me functionality
- Role-based access display

### 2. Dashboard
- Current shift status display
- Pending meter readings counter
- Total readings today
- Last reading timestamp
- Quick access buttons for:
  - Camera capture
  - Manual entry
  - Reading history

### 3. Camera & OCR
- Full-screen camera with guideline overlay
- Flash toggle
- Front/back camera switch
- Image preview with retake option
- AI-powered OCR using Claude API
- Image preprocessing for better OCR accuracy
- Confidence score display
- Manual correction option

### 4. Meter Reading Form
- Nozzle selection (dropdown with fuel type)
- Shift selection (auto-selected current shift)
- Reading type toggle (opening/closing)
- Meter value input (pre-filled from OCR)
- Image preview with OCR badge
- Form validation
- Submit with haptic feedback

### 5. Readings History
- Filter by: All / OCR Only / Manual Only
- Display image thumbnails
- OCR vs Manual indicator with confidence
- Variance calculations
- Pull-to-refresh
- Date/time formatting

### 6. Settings
- User profile display
- Offline sync status
- Pending readings counter
- Manual sync trigger
- API endpoint configuration
- Dark mode toggle (UI ready)
- Cache management
- Logout with confirmation

### 7. Offline Support
- Queue readings when offline
- Offline indicator banner
- Auto-sync when back online
- Network status monitoring
- Pending readings display

## Tech Stack

- **Framework**: React Native + Expo
- **Language**: TypeScript
- **Navigation**: React Navigation (Native Stack)
- **State Management**: Zustand
- **Server State**: TanStack Query (React Query)
- **Storage**: AsyncStorage
- **Camera**: expo-camera
- **Image Processing**: expo-image-manipulator
- **OCR**: Claude API (claude-3-5-sonnet-20241022)
- **API Client**: Axios
- **Offline Support**: NetInfo
- **UI Feedback**: expo-haptics

## Project Structure

```
apps/mobile/
├── src/
│   ├── screens/
│   │   ├── LoginScreen.tsx           # Authentication screen
│   │   ├── DashboardScreen.tsx       # Main dashboard
│   │   ├── CameraScreen.tsx          # Camera capture
│   │   ├── OCRProcessingScreen.tsx   # AI processing & results
│   │   ├── MeterReadingFormScreen.tsx # Submit reading
│   │   ├── ReadingsHistoryScreen.tsx # Browse history
│   │   └── SettingsScreen.tsx        # App settings
│   ├── api/
│   │   ├── client.ts                 # Axios API client with interceptors
│   │   └── ocr.ts                    # Claude API OCR integration
│   ├── store/
│   │   ├── authStore.ts              # Authentication state
│   │   └── offlineStore.ts           # Offline queue state
│   ├── utils/
│   │   ├── imageProcessing.ts        # Image enhancement for OCR
│   │   └── offline.ts                # Network monitoring & sync
│   ├── navigation/
│   │   └── AppNavigator.tsx          # Navigation setup
│   ├── types/
│   │   └── index.ts                  # TypeScript interfaces
│   └── App.tsx                       # Root component
├── app.json                          # Expo configuration
├── package.json
├── tsconfig.json
├── babel.config.js
└── .env                              # Environment variables
```

## Environment Variables

Create a `.env` file in the mobile app root:

```bash
API_URL=http://localhost:8000/api/v1
CLAUDE_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

## Installation

```bash
# Navigate to mobile app directory
cd apps/mobile

# Install dependencies
npm install
# or
pnpm install

# Start development server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## OCR Integration

The app uses Claude 3.5 Sonnet API for meter reading extraction:

### How It Works

1. **Image Capture**: User captures meter photo with camera
2. **Preprocessing**: Image is resized and optimized
3. **Base64 Conversion**: Image converted to base64 for API
4. **Claude API Call**: Sent to Claude with specialized prompt
5. **Extraction**: Claude extracts numerical meter reading
6. **Confidence Score**: App calculates confidence based on response
7. **User Review**: User can accept OCR value or correct manually

### Claude API Prompt

```
Extract the numerical meter reading from this fuel dispenser meter.

Rules:
1. Return ONLY the number you see on the meter display
2. Do not include units, decimal points unless clearly visible, or any text
3. If you see multiple numbers, return the main/largest meter reading
4. If the reading is unclear or you cannot find a meter, return "UNCLEAR"
```

### Confidence Calculation

- **High (>80%)**: Response is pure number
- **Medium (50-80%)**: Number extracted with context
- **Low (<50%)**: Unclear or error

## API Integration

### Authentication

```typescript
POST /api/v1/auth/login
Content-Type: application/x-www-form-urlencoded

username=user@example.com&password=secret

Response:
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

### Meter Reading Submission

```typescript
POST /api/v1/meter-readings
Authorization: Bearer <token>

{
  "nozzle_id": "uuid",
  "shift_id": "uuid",
  "reading_type": "opening",
  "meter_value": 12345.67,
  "image_base64": "data:image/jpeg;base64,...",
  "is_ocr": true,
  "ocr_confidence": 0.95
}
```

## Offline Support

The app supports offline operation:

1. **Network Monitoring**: Uses NetInfo to detect connection status
2. **Offline Queue**: Readings stored in AsyncStorage when offline
3. **Auto-Sync**: Automatically syncs when connection restored
4. **Visual Feedback**: Orange banner shows offline status
5. **Manual Sync**: User can trigger sync from Settings

## Image Processing

Before OCR, images are processed for better accuracy:

- Resize to max 1920px width
- JPEG compression (0.9 quality)
- Optional contrast enhancement
- Optional grayscale conversion
- Optional cropping to meter area

## Haptic Feedback

The app provides haptic feedback for better UX:

- **Medium Impact**: Camera capture
- **Light Impact**: Toggle buttons (flash, camera switch)
- **Success**: OCR extraction, form submission
- **Error**: OCR failure, validation errors
- **Warning**: Logout confirmation

## TypeScript Strictness

The app is built with strict TypeScript:

- `strictNullChecks: true`
- No `any` types (uses proper interfaces)
- Runtime type guards for API responses
- Defensive coding with optional chaining
- Proper error handling with typed catch blocks

## Validation & Error Handling

### Form Validation
- Required fields check
- Numeric validation for meter value
- Must be greater than previous reading
- Image size limits

### Network Error Handling
- 401: Auto logout and redirect to login
- 500: Show user-friendly error
- Timeout: Retry with exponential backoff
- Network error: Queue for offline sync

## Future Enhancements

1. **Dark Mode**: UI ready, implementation pending
2. **Push Notifications**: Shift reminders, sync alerts
3. **Biometric Auth**: Face ID / Touch ID
4. **Barcode Scanner**: Quick nozzle selection
5. **Voice Input**: Meter value dictation
6. **Image Filters**: Advanced preprocessing
7. **Local ML**: On-device OCR fallback
8. **Multi-language**: Arabic support
9. **Analytics**: Usage tracking
10. **Export**: CSV/PDF reports

## Testing

```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Run tests (when implemented)
npm test
```

## Building for Production

### Android

```bash
# Create production build
eas build --platform android

# Or local build
npx expo run:android --variant release
```

### iOS

```bash
# Create production build
eas build --platform ios

# Or local build
npx expo run:ios --configuration Release
```

## Troubleshooting

### Camera Permission Denied

1. Open device Settings
2. Find Kuwait Petrol Pump app
3. Enable Camera permission

### OCR Not Working

1. Check internet connection
2. Verify CLAUDE_API_KEY in .env
3. Ensure image is clear and meter visible
4. Try manual entry as fallback

### Offline Sync Stuck

1. Open Settings
2. Check pending readings count
3. Tap "Sync Now" when online
4. Or clear cache and re-submit

### API Connection Failed

1. Verify API_URL in .env
2. Check backend server is running
3. Test with curl or Postman
4. Check network firewall/proxy

## License

Proprietary - Kuwait Petrol Pump System

## Support

For issues or questions, contact the development team.
