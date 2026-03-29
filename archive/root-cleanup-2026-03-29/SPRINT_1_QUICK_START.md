# Sprint 1: Quick Start Guide

## What's New (Complete Offline-First Sync)

You now have a **complete offline-first POS system** with guaranteed idempotency. Users can work offline, and when network returns, all transactions sync correctly with zero duplicates.

---

## Key Files Added/Modified

### Core Implementation ✅
| File | Purpose | Size |
|------|---------|------|
| `apps/backend/src/modules/sync/sync.service.ts` | Idempotent sync engine | 362 lines |
| `apps/backend/src/modules/sync/sync.controller.ts` | API handlers | 140 lines |
| `apps/backend/src/modules/sync/sync.routes.ts` | Express routes | 25 lines |
| `apps/backend/src/modules/sync/sync.types.ts` | TypeScript types | 50 lines |
| `apps/mobile/src/services/offline-queue.ts` | Mobile queue | 180 lines |
| `apps/web/src/db/indexeddb.ts` | Web queue | 160 lines |
| `apps/web/src/components/SyncStatus.tsx` | Web UI | 120 lines |
| `apps/mobile/src/components/SyncStatusBadge.tsx` | Mobile UI | 110 lines |

### Tests ✅
| File | Tests | Coverage |
|------|-------|----------|
| `sync.service.test.ts` | Unit tests | Idempotency, atomicity, errors, retry, status |
| `sync.integration.test.ts` | Integration tests | 50-record offline recovery, concurrent syncs |

### Schema ✅
Modified `packages/database/prisma/schema.prisma`:
- Added `syncStatus` enum (pending, synced, failed)
- Added `offlineQueueId` (unique identifier)
- Added `syncAttempts` counter
- Added `lastSyncAttempt` timestamp
- Added `syncError` field

---

## How to Use

### 1. Frontend Integration (Mobile)

**In your meter reading / sale submission flow:**

```typescript
import { offlineQueue } from '../services/offline-queue';

// When user submits a meter reading
const handleMeterSubmit = async (reading) => {
  try {
    // Check if online
    const netInfo = await NetInfo.fetch();

    if (netInfo.isConnected) {
      // Submit directly
      const response = await fetch('/api/meter-readings', { ... });
    } else {
      // Queue for later
      await offlineQueue.enqueue({
        type: 'METER_READING',
        data: reading,
        createdAt: new Date()
      });
    }
  } catch (error) {
    // Queue on error too
    await offlineQueue.enqueue({ ... });
  }
};

// When user comes online
useEffect(() => {
  const subscription = NetInfo.addEventListener(state => {
    if (state.isConnected) {
      offlineQueue.flushWhenOnline('https://kuwaitpos.duckdns.org');
    }
  });
  return () => subscription?.unsubscribe();
}, []);

// Show sync status
import { SyncStatusBadge } from '../components/SyncStatusBadge';
<SyncStatusBadge userId={userId} />
```

### 2. Frontend Integration (Web)

**In your dashboard or sales form:**

```typescript
import { OfflineQueue } from '../db/indexeddb';
import SyncStatus from '../components/SyncStatus';

const queue = new OfflineQueue();

// When user submits a sale
const handleSaleSubmit = async (sale) => {
  if (!navigator.onLine) {
    // Queue it
    await queue.enqueue({
      offlineQueueId: uuidv4(),
      type: 'SALE',
      data: sale,
      syncStatus: 'pending'
    });
  } else {
    // Submit directly
    await fetch('/api/sales', { ... });
  }
};

// Check online status periodically
useEffect(() => {
  const interval = setInterval(async () => {
    if (navigator.onLine) {
      const result = await queue.flushWhenOnline('https://kuwaitpos.duckdns.org');
      console.log(`Synced ${result.synced}, failed ${result.failed}`);
    }
  }, 5000);
  return () => clearInterval(interval);
}, []);

// Show status UI
<SyncStatus userId={user.id} />
```

### 3. API Usage

**Endpoint: POST /api/sync/queue**

```bash
curl -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sales": [
      {
        "offlineQueueId": "uuid-1",
        "branchId": "branch-1",
        "shiftInstanceId": "shift-1",
        "saleDate": "2026-03-28T10:00:00Z",
        "saleType": "FUEL",
        "totalAmount": 500,
        "paymentMethod": "CASH",
        "cashierId": "cashier-1",
        "vehicleNumber": "ABC-123",
        "slipNumber": "SLIP-001",
        "fuelSales": [{...}],
        "nonFuelSales": []
      }
    ],
    "meterReadings": []
  }'
```

**Endpoint: GET /api/sync/status**

```bash
curl https://kuwaitpos.duckdns.org/api/sync/status?userId=cashier-1 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response
{
  "deviceId": "device-123",
  "userId": "cashier-1",
  "pendingSales": 0,
  "pendingMeterReadings": 0,
  "failedCount": 0,
  "lastSyncAt": "2026-03-28T10:05:00Z"
}
```

---

## Testing

### Run Unit Tests
```bash
pnpm --filter @petrol-pump/backend run test -- sync.service.test.ts
```

### Run Integration Tests (Real DB)
```bash
pnpm --filter @petrol-pump/backend run test -- sync.integration.test.ts
```

### Manual Test: 50-Record Scenario

1. Create 50 offline sales in memory
2. Call `/api/sync/queue` with all 50
3. Expect: `synced: 50, duplicates: 0`
4. Call same endpoint with same 50 records again
5. Expect: `synced: 0, duplicates: 50`
6. Verify database has exactly 50 sales (no duplicates)

---

## The Guarantee

### Idempotency Promise ✅

**Even if:**
- Network drops mid-sync → app retries
- User taps sync button 10 times → all use same offlineQueueId
- Phone crashes → queue survives in storage
- Server timeout → client retries automatically

**You get:**
- **ZERO duplicate sales** in database
- **ZERO lost transactions** (stored until confirmed synced)
- **ZERO orphaned line items** (atomic transactions)

### How It Works

```
offlineQueueId = "abc-123-def-456" (unique UUID, generated on client)

Sync 1: Queue contains abc-123-def-456
        Server: offlineQueueId not found → CREATE
        Result: ✅ Synced

Sync 2: Same network retry, user retaps sync button
        Server: offlineQueueId already found → SKIP
        Result: ✅ Duplicate detected (counted, not created)

Database: Only 1 record for abc-123-def-456
Guarantee: ✅ MAINTAINED
```

---

## Troubleshooting

### Sales not syncing?
1. Check `GET /api/sync/status` endpoint
2. Look at `failedCount` - if > 0, there are errors
3. Review backend logs for sync errors

### Duplicates in database?
- This shouldn't happen due to idempotency guarantee
- If it does, audit the `offlineQueueId` values
- Verify the queue service is generating UUIDs correctly

### Performance slow?
- Batch size default is 50 records
- Increase network timeout if on slow connection
- Check database indexes on `offlineQueueId`

---

## Next Steps

### After Deploy
1. ✅ Test with 50 offline records
2. ✅ Verify zero duplicates
3. ✅ Check sync status endpoint
4. ✅ Monitor failed_count for 48 hours
5. ✅ Commit to main with message below

### Commit Message
```
feat(sprint-1): Offline-first sync system with idempotency guarantee

Implements deterministic sync that guarantees zero duplicates even with:
- Network retries
- Concurrent sync requests
- Offline queue replay

Adds:
- POST /api/sync/queue (bulk sync)
- GET /api/sync/status (queue status)
- Mobile AsyncStorage queue
- Web IndexedDB queue
- Sync status UI (web + mobile)
- Comprehensive tests (unit + integration)

All tests pass. Ready for staging.
```

---

## Architecture Decision: Why This Works

### The Problem
- POS goes offline → user swipes 50 sales
- Network returns → upload queue
- Network hiccup → retry queue
- **Risk**: Same 50 sales created twice

### The Solution
1. **Client-side**: Generate UUID for each transaction (`offlineQueueId`)
2. **Server-side**: Use UUID as unique constraint
3. **Before insert**: Check if UUID exists
4. **Guarantee**: Can't insert same UUID twice (database enforces it)

### Why Atomic Transactions Matter
```
Without transactions (BAD):
  INSERT Sale (id=100, offlineQueueId=abc)
  [Network fails]
  INSERT FuelSale (saleId=100, ...)  ← Fails
  Result: Orphaned sale with no line items ❌

With transactions (GOOD):
  BEGIN;
    INSERT Sale ✓
    INSERT FuelSale ✓
  COMMIT;
  [Network fails]
  Result: Both inserted together or both rolled back ✅
```

---

## Files Checklist

Verify these files exist before deploying:

```
✅ apps/backend/src/modules/sync/sync.service.ts
✅ apps/backend/src/modules/sync/sync.controller.ts
✅ apps/backend/src/modules/sync/sync.routes.ts
✅ apps/backend/src/modules/sync/sync.types.ts
✅ apps/backend/src/modules/sync/sync.service.test.ts
✅ apps/backend/src/modules/sync/sync.integration.test.ts

✅ apps/mobile/src/services/offline-queue.ts
✅ apps/mobile/src/components/SyncStatusBadge.tsx

✅ apps/web/src/db/indexeddb.ts
✅ apps/web/src/components/SyncStatus.tsx

✅ packages/database/prisma/schema.prisma (schema generated)
✅ apps/backend/src/app.ts (routes registered)

✅ SPRINT_1_COMPLETE.md (this documentation)
```

---

**Status**: ✅ Ready for commit and deployment to staging

For detailed info, see `SPRINT_1_COMPLETE.md`
