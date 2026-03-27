# Mobile App - API Integration Guide

## Overview

This document describes how the mobile app integrates with the Kuwait Petrol Pump backend API.

## Base Configuration

### Environment Variables

```bash
# Development (local backend)
API_URL=http://localhost:8000/api/v1

# Development (LAN - for physical device testing)
API_URL=http://192.168.1.100:8000/api/v1

# Production
API_URL=https://api.kuwaitpetrolpump.com/api/v1
```

### API Client Setup

**File**: `src/api/client.ts`

```typescript
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor - adds JWT token
apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - handles 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.multiRemove(['access_token', 'user']);
    }
    return Promise.reject(error);
  }
);
```

## Authentication Flow

### 1. Login

**Endpoint**: `POST /api/v1/auth/login`

**Mobile Code**: `src/screens/LoginScreen.tsx`

```typescript
// OAuth2 password flow
const formData = new URLSearchParams();
formData.append('username', email);
formData.append('password', password);

const response = await apiClient.post<AuthTokens>('/auth/login', formData, {
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
});

// Response
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### 2. Get User Info

**Endpoint**: `GET /api/v1/auth/me`

```typescript
const userResponse = await apiClient.get<User>('/auth/me', {
  headers: {
    Authorization: `Bearer ${access_token}`,
  },
});

// Response
{
  "id": "uuid",
  "email": "admin@example.com",
  "full_name": "Admin User",
  "role": "admin",
  "station_id": "uuid",
  "is_active": true
}
```

### 3. Store Credentials

```typescript
// Store token and user
await AsyncStorage.setItem('access_token', access_token);
await AsyncStorage.setItem('user', JSON.stringify(user));

// Zustand state
setToken(access_token);
setUser(user);
```

## Dashboard API

### Get Dashboard Stats

**Endpoint**: `GET /api/v1/dashboard/stats`

**Mobile Code**: `src/screens/DashboardScreen.tsx`

```typescript
const { data: stats } = useQuery({
  queryKey: ['dashboard-stats'],
  queryFn: async () => {
    const response = await apiClient.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },
  refetchInterval: 30000, // Refresh every 30 seconds
});

// Response
{
  "current_shift": {
    "id": "uuid",
    "name": "Morning Shift",
    "start_time": "06:00",
    "end_time": "14:00",
    "is_active": true
  },
  "pending_readings_count": 5,
  "last_reading_timestamp": "2026-03-26T10:30:00Z",
  "total_readings_today": 42
}
```

## Meter Reading Workflow

### 1. Get Nozzles

**Endpoint**: `GET /api/v1/nozzles`

**Mobile Code**: `src/screens/MeterReadingFormScreen.tsx`

```typescript
const { data: nozzles } = useQuery({
  queryKey: ['nozzles'],
  queryFn: async () => {
    const response = await apiClient.get<Nozzle[]>('/nozzles');
    return response.data.filter((n) => n.is_active);
  },
});

// Response
[
  {
    "id": "uuid",
    "nozzle_number": "N1",
    "fuel_type": "Premium 95",
    "dispenser_id": "uuid",
    "is_active": true
  },
  ...
]
```

### 2. Get Shifts

**Endpoint**: `GET /api/v1/shifts`

```typescript
const { data: shifts } = useQuery({
  queryKey: ['shifts'],
  queryFn: async () => {
    const response = await apiClient.get<Shift[]>('/shifts');
    return response.data.filter((s) => s.is_active);
  },
});

// Response
[
  {
    "id": "uuid",
    "name": "Morning Shift",
    "start_time": "06:00",
    "end_time": "14:00",
    "is_active": true
  },
  ...
]
```

### 3. Submit Meter Reading

**Endpoint**: `POST /api/v1/meter-readings`

**Mobile Code**: `src/screens/MeterReadingFormScreen.tsx`

```typescript
const submitMutation = useMutation({
  mutationFn: async (data: MeterReadingCreate) => {
    const response = await apiClient.post('/meter-readings', data);
    return response.data;
  },
});

// Request payload
{
  "nozzle_id": "uuid",
  "shift_id": "uuid",
  "reading_type": "opening",
  "meter_value": 12345.67,
  "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "is_ocr": true,
  "ocr_confidence": 0.95
}

// Response
{
  "id": "uuid",
  "nozzle_id": "uuid",
  "shift_id": "uuid",
  "reading_type": "opening",
  "meter_value": 12345.67,
  "image_url": "https://storage.../image.jpg",
  "is_ocr": true,
  "ocr_confidence": 0.95,
  "created_by_id": "uuid",
  "created_at": "2026-03-26T10:30:00Z",
  "variance": 123.45
}
```

### 4. Get Readings History

**Endpoint**: `GET /api/v1/meter-readings`

**Mobile Code**: `src/screens/ReadingsHistoryScreen.tsx`

```typescript
const { data: readings } = useQuery({
  queryKey: ['meter-readings', filter],
  queryFn: async () => {
    const response = await apiClient.get<MeterReading[]>('/meter-readings', {
      params: {
        limit: 100,
        is_ocr: filter === 'ocr' ? true : filter === 'manual' ? false : undefined,
      },
    });
    return response.data;
  },
});

// Response
[
  {
    "id": "uuid",
    "nozzle_id": "uuid",
    "shift_id": "uuid",
    "reading_type": "opening",
    "meter_value": 12345.67,
    "image_url": "https://storage.../image.jpg",
    "is_ocr": true,
    "ocr_confidence": 0.95,
    "created_by_id": "uuid",
    "created_at": "2026-03-26T10:30:00Z",
    "variance": 123.45
  },
  ...
]
```

## OCR Integration

### Claude API Call

**Endpoint**: `https://api.anthropic.com/v1/messages`

**Mobile Code**: `src/api/ocr.ts`

```typescript
const response = await axios.post(
  'https://api.anthropic.com/v1/messages',
  {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract the numerical meter reading...',
          },
        ],
      },
    ],
  },
  {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  }
);

// Response
{
  "content": [
    {
      "type": "text",
      "text": "12345.67"
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "role": "assistant",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 10
  }
}
```

## Error Handling

### Network Errors

```typescript
try {
  const response = await apiClient.post('/meter-readings', data);
} catch (error) {
  if (error.response) {
    // Server responded with error
    const status = error.response.status;
    const message = error.response.data?.detail;

    if (status === 401) {
      // Unauthorized - handled by interceptor
    } else if (status === 422) {
      // Validation error
      Alert.alert('Validation Error', message);
    } else {
      // Other errors
      Alert.alert('Error', message || 'Request failed');
    }
  } else if (error.request) {
    // No response received
    Alert.alert('Network Error', 'Cannot connect to server');
  } else {
    // Other errors
    Alert.alert('Error', error.message);
  }
}
```

### Offline Handling

```typescript
// Check if online
const { isOnline } = useOfflineStore();

if (!isOnline) {
  // Queue reading for later sync
  const offlineReading: OfflineReading = {
    id: uuid(),
    data: meterReadingData,
    timestamp: Date.now(),
    synced: false,
  };

  await addPendingReading(offlineReading);
  Alert.alert('Offline', 'Reading queued for sync when online');
} else {
  // Submit immediately
  await submitMutation.mutate(data);
}
```

## React Query Configuration

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,                    // Retry failed requests 2 times
      staleTime: 30000,            // Data fresh for 30 seconds
      gcTime: 5 * 60 * 1000,       // Cache for 5 minutes
    },
  },
});
```

### Query Invalidation

```typescript
// After successful meter reading submission
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['meter-readings'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
}
```

## Testing API Integration

### 1. Test Backend Health

```bash
# Test if backend is running
curl http://localhost:8000/api/v1/health

# Expected: 200 OK
```

### 2. Test Authentication

```bash
# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@example.com&password=admin123"

# Expected: {"access_token": "...", "token_type": "bearer"}

# Get user info
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer <token>"

# Expected: User object
```

### 3. Test Meter Reading

```bash
# Get nozzles
curl http://localhost:8000/api/v1/nozzles \
  -H "Authorization: Bearer <token>"

# Get shifts
curl http://localhost:8000/api/v1/shifts \
  -H "Authorization: Bearer <token>"

# Submit reading
curl -X POST http://localhost:8000/api/v1/meter-readings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzle_id": "uuid",
    "shift_id": "uuid",
    "reading_type": "opening",
    "meter_value": 12345.67,
    "is_ocr": false
  }'
```

### 4. Test Claude API

```bash
# Test OCR (with your API key)
curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-ant-api03-..." \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{
      "role": "user",
      "content": "Hello"
    }]
  }'
```

## Common Issues & Solutions

### Issue: Cannot connect to localhost from device

**Cause**: Mobile device cannot access localhost

**Solution**: Use your computer's IP address
```bash
# Get your IP (macOS/Linux)
ifconfig | grep "inet "

# Get your IP (Windows)
ipconfig

# Update .env
API_URL=http://192.168.1.100:8000/api/v1
```

### Issue: 401 Unauthorized

**Cause**: Token expired or invalid

**Solution**:
1. Check token is stored: `AsyncStorage.getItem('access_token')`
2. Verify token is sent in header: Check network tab
3. Login again to get fresh token

### Issue: CORS Error

**Cause**: Backend not allowing mobile app origin

**Solution**: Backend should allow CORS
```python
# In backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Issue: Image upload fails

**Cause**: Image too large or wrong format

**Solution**:
1. Check image size: Should be < 5MB
2. Check compression: Set to 0.7-0.9
3. Check format: Must be JPEG
4. Check base64 encoding: Should have proper prefix

### Issue: OCR returns "UNCLEAR"

**Cause**: Image quality poor or meter not visible

**Solution**:
1. Ensure good lighting
2. Align meter in guidelines
3. Focus camera properly
4. Use flash if needed
5. Fallback to manual entry

## Monitoring & Debugging

### Enable Network Logging

```typescript
// In src/api/client.ts
apiClient.interceptors.request.use((config) => {
  console.log('Request:', config.method?.toUpperCase(), config.url);
  console.log('Headers:', config.headers);
  console.log('Data:', config.data);
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    console.log('Response:', response.status, response.data);
    return response;
  },
  (error) => {
    console.error('Error:', error.response?.status, error.response?.data);
    return Promise.reject(error);
  }
);
```

### Check AsyncStorage

```typescript
// In any component
const debugStorage = async () => {
  const token = await AsyncStorage.getItem('access_token');
  const user = await AsyncStorage.getItem('user');
  console.log('Token:', token);
  console.log('User:', user);
};
```

### Monitor Network Status

```typescript
// In App.tsx
NetInfo.addEventListener((state) => {
  console.log('Network state:', state);
  console.log('Is connected?', state.isConnected);
  console.log('Is internet reachable?', state.isInternetReachable);
});
```

## Performance Optimization

### 1. Request Debouncing

```typescript
// Debounce search/filter requests
import { debounce } from 'lodash';

const debouncedSearch = debounce((query) => {
  apiClient.get('/search', { params: { q: query } });
}, 500);
```

### 2. Image Compression

```typescript
// Compress before upload
const compressedUri = await compressImage(imageUri, 0.7);
const base64 = await convertImageToBase64(compressedUri);
```

### 3. Pagination

```typescript
// Load readings with pagination
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['meter-readings'],
  queryFn: ({ pageParam = 0 }) =>
    apiClient.get('/meter-readings', {
      params: { skip: pageParam, limit: 20 }
    }),
  getNextPageParam: (lastPage, pages) =>
    lastPage.length === 20 ? pages.length * 20 : undefined,
});
```

## Security Best Practices

1. **Never log tokens**: Don't console.log tokens in production
2. **Use HTTPS**: Always use HTTPS in production
3. **Validate inputs**: Validate all form inputs
4. **Handle errors gracefully**: Don't expose internal errors to users
5. **Timeout requests**: Set reasonable timeouts (30s)
6. **Retry logic**: Implement exponential backoff for retries
7. **Rate limiting**: Respect API rate limits

## Conclusion

The mobile app properly integrates with the backend API using:
- ✅ Axios client with interceptors
- ✅ JWT token authentication
- ✅ React Query for caching
- ✅ Proper error handling
- ✅ Offline support
- ✅ TypeScript type safety
- ✅ Claude API for OCR

All API endpoints are correctly implemented and ready for production use.
