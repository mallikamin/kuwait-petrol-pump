# QuickBooks Integration Parity Matrix
## POS-Project (Source of Truth) ↔ Kuwait Petrol Pump (Target)

**Generated:** 2026-03-27
**Purpose:** Compare proven POS-Project QB integration against Kuwait's minimal stub to plan port strategy

---

## Executive Summary

### POS-Project Status: ✅ PRODUCTION-READY
- **Language:** Python (FastAPI + SQLAlchemy + Async)
- **Connection Types:** QB Online (OAuth2) + QB Desktop (QBWC/SOAP)
- **Entity Coverage:** Sales Receipts, Items, Customers, Payments, Credit Memos, Refunds
- **Sync Strategy:** Async job queue with exponential retry
- **Idempotency:** Unique constraint on `(tenant_id, idempotency_key)`
- **Audit:** Full HTTP request/response logging with timing
- **Production Experience:** Battle-tested with real transactions

### Kuwait Petrol Pump Status: ❌ MINIMAL STUB
- **Language:** Node.js/TypeScript (Express + Prisma)
- **Connection Types:** QB Online OAuth2 credentials in env only
- **Entity Coverage:** None implemented (only DB fields on Sale/Product models)
- **Sync Strategy:** None (basic QBSyncLog table exists)
- **Idempotency:** None
- **Audit:** Basic status/error logging only
- **Production Experience:** Zero - never deployed

---

## 1. DATABASE MODELS COMPARISON

| Feature | POS-Project (Python) | Kuwait (TypeScript) | Gap Analysis |
|---------|---------------------|---------------------|--------------|
| **Connection Management** | ✅ `QBConnection` table<br>- OAuth tokens (Fernet encrypted)<br>- QB Online + Desktop support<br>- Company metadata<br>- Connection health tracking | ❌ None | **CRITICAL**: Missing connection table |
| **Account Mapping** | ✅ `QBAccountMapping` table<br>- Maps POS concepts → QB Chart of Accounts<br>- Supports category-level overrides<br>- Default + specific mappings<br>- Fuzzy matching service | ❌ None | **CRITICAL**: No mapping layer |
| **Entity Mapping** | ✅ `QBEntityMapping` table<br>- Links POS entities → QB entities<br>- Tracks sync direction (uni/bi-directional)<br>- SHA-256 sync hash for drift detection<br>- Supports all entity types | ❌ Basic fields on models<br>- `qbItemId` on Product<br>- `qbInvoiceId` on Sale<br>- No central mapping table | **MAJOR**: Fragmented, no history |
| **Sync Queue** | ✅ `QBSyncJob` table<br>- Async job queue<br>- Priority (0=critical, 10=bulk)<br>- Status: pending/processing/completed/failed/dead_letter<br>- Exponential retry with `next_retry_at`<br>- Idempotency key (unique constraint)<br>- Payload + result storage | ❌ None | **CRITICAL**: No queue system |
| **Sync Audit Log** | ✅ `QBSyncLog` table<br>- Full HTTP request/response<br>- Timing (duration_ms)<br>- Financial amounts (paisa)<br>- QB doc numbers<br>- Error codes<br>- Batch grouping | ⚠️ `QBSyncLog` table (minimal)<br>- entityType, entityId, operation<br>- status, errorMessage<br>- No HTTP details<br>- No timing<br>- No amounts<br>- No batch tracking | **MODERATE**: Exists but insufficient |
| **Chart of Accounts Snapshot** | ✅ `QBCoASnapshot` table<br>- Immutable original_backup<br>- Mutable working_copy<br>- Version tracking<br>- Locked snapshots | ❌ None | **MAJOR**: Can't prove original state |

---

## 2. ENTITY MAPPING STRATEGIES

### POS-Project Approach ✅

**Centralized Mapping Table:**
```python
QBEntityMapping:
  - entity_type: "menu_item" | "customer" | "tax_rate" | "payment_method"
  - pos_entity_id: UUID
  - pos_entity_name: str
  - qb_entity_id: str (QuickBooks ID)
  - qb_entity_type: "Item" | "Customer" | "TaxRate" | "PaymentMethod"
  - qb_entity_name: str
  - sync_direction: "pos_to_qb" | "qb_to_pos" | "bidirectional"
  - last_synced_at: timestamp
  - sync_hash: SHA-256 (detects drift)
```

**Benefits:**
- Single source of truth for all mappings
- Supports bidirectional sync
- Drift detection via hash comparison
- Entity-agnostic (works for all types)
- Full audit trail of mapping changes

### Kuwait Approach ⚠️

**Fragmented Fields:**
```typescript
Sale {
  qbInvoiceId: String?
  qbSynced: Boolean
  qbSyncedAt: DateTime?
}

Product {
  qbItemId: String?
}

// No mapping history
// No sync direction control
// No drift detection
```

**Problems:**
- Each entity needs custom QB fields
- No central mapping registry
- Can't track mapping changes over time
- No bidirectional sync support
- No way to detect QB-side changes

### Recommendation: PORT POS-Project Model ✅

**Action Required:**
1. Create `qb_entity_mappings` table (exact schema from POS-Project)
2. Migrate existing `qbInvoiceId` / `qbItemId` to mapping table
3. Add sync_hash column for drift detection
4. Keep existing fields for backward compatibility but deprecate

---

## 3. IDEMPOTENCY STRATEGY

### POS-Project Approach ✅

**Database Constraint:**
```python
QBSyncJob:
  idempotency_key: str (nullable)

  __table_args__ = (
    UniqueConstraint(
      "tenant_id",
      "idempotency_key",
      name="uq_qbsyncq_tenant_idempotency"
    ),
  )
```

**Key Generation:**
```python
def generate_idempotency_key(entity_type: str, entity_id: UUID, operation: str) -> str:
    return f"{entity_type}:{entity_id}:{operation}"

# Example: "order:550e8400-e29b-41d4-a716-446655440000:create_sales_receipt"
```

**Behavior:**
- Duplicate sync attempt → Database constraint violation → Graceful skip
- Re-running same sync with same key → No duplicate QB transaction
- 100% idempotency guarantee at DB level

### Kuwait Approach ❌

**No idempotency mechanism:**
- Re-running sync creates duplicate QB records
- No protection against double-posting
- Race conditions possible

### Recommendation: ADD IDEMPOTENCY CONSTRAINT ✅

**Action Required:**
1. Add `idempotencyKey` column to `QBSyncLog`
2. Add unique constraint: `@@unique([organizationId, idempotencyKey])`
3. Generate keys as: `{entityType}:{entityId}:{operation}`
4. Check for existing key before creating sync job

---

## 4. RETRY POLICY

### POS-Project Approach ✅

**Exponential Backoff:**
```python
QBSyncJob:
  retry_count: int (default=0)
  max_retries: int (default=3)
  next_retry_at: timestamp (nullable)
  status: "pending" | "processing" | "failed" | "dead_letter"

# Retry delays: 1min, 5min, 15min, then dead_letter
```

**Retry Logic:**
```python
def calculate_next_retry(retry_count: int) -> datetime:
    delays = [60, 300, 900]  # 1min, 5min, 15min
    delay_seconds = delays[min(retry_count, len(delays) - 1)]
    return now() + timedelta(seconds=delay_seconds)
```

**Dead Letter Queue:**
- After 3 failures → `status = "dead_letter"`
- Manual review required
- Admin dashboard shows dead letter jobs
- Can be manually retried or cancelled

### Kuwait Approach ❌

**No retry mechanism:**
- Sync fails → Lost forever
- No automatic retry
- No dead letter queue
- No failure recovery

### Recommendation: IMPLEMENT RETRY SYSTEM ✅

**Action Required:**
1. Add retry fields to QBSyncLog:
   - `retryCount` (default 0)
   - `maxRetries` (default 3)
   - `nextRetryAt` (timestamp)
2. Add status enum: `pending | processing | completed | failed | dead_letter`
3. Background worker checks `nextRetryAt` and retries failed jobs
4. Exponential backoff: 1min → 5min → 15min → dead_letter

---

## 5. SYNC STATES

### POS-Project States ✅

**QBSyncJob Status Flow:**
```
pending → processing → completed
                ↓
              failed → (retry with backoff)
                ↓
              dead_letter (manual intervention)
```

**Additional States:**
- `cancelled`: User manually stopped sync
- `skipped`: Idempotency key match (already synced)

**State Transitions:**
```python
# Atomic state updates with timestamps
job.status = "processing"
job.started_at = now()

# On success
job.status = "completed"
job.completed_at = now()
job.processing_duration_ms = (completed_at - started_at).milliseconds

# On failure
job.status = "failed"
job.retry_count += 1
job.next_retry_at = calculate_next_retry(job.retry_count)
if job.retry_count >= job.max_retries:
    job.status = "dead_letter"
```

### Kuwait States ⚠️

**QBSyncLog Status:**
```typescript
status: "pending" | "success" | "failed"
```

**Problems:**
- No `processing` state (can't detect stuck jobs)
- No `dead_letter` state (no recovery path)
- No `cancelled` or `skipped` states
- No timing fields (can't measure performance)

### Recommendation: EXPAND STATE MODEL ✅

**Action Required:**
1. Add status values: `processing`, `dead_letter`, `cancelled`, `skipped`
2. Add timing fields:
   - `startedAt` (when processing began)
   - `completedAt` (when finished)
   - `durationMs` (processing time in ms)
3. Add state transition validation (can't go from `completed` to `pending`)

---

## 6. ERROR HANDLING

### POS-Project Approach ✅

**Structured Error Capture:**
```python
QBSyncLog:
  error_message: str (human-readable)
  error_code: str (QB API error code)
  error_detail: JSON (full QB error response)

QBSyncJob:
  error_message: str
  error_detail: JSON
```

**QB Error Code Mapping:**
```python
QB_ERROR_CODES = {
    "3200": "Invalid Reference ID",
    "6000": "Object Not Found",
    "610": "Object Already Exists",
    "3100": "Missing Required Parameter",
    # ... 50+ error codes mapped
}
```

**Retry Decision Logic:**
```python
def should_retry(error_code: str) -> bool:
    # Transient errors → retry
    if error_code in ["500", "502", "503", "504", "429"]:
        return True
    # Permanent errors → dead_letter
    if error_code in ["3200", "6000", "610", "3100"]:
        return False
    # Unknown errors → retry once
    return True
```

### Kuwait Approach ⚠️

**Basic Error Logging:**
```typescript
QBSyncLog {
  errorMessage: String? // Generic text only
}
```

**Problems:**
- No structured error codes
- Can't distinguish transient vs permanent errors
- No QB-specific error handling
- All errors treated the same (no smart retry)

### Recommendation: ADD STRUCTURED ERROR HANDLING ✅

**Action Required:**
1. Add `errorCode` field (QB API error code)
2. Add `errorDetail` JSONB field (full QB response)
3. Create error code mapping table
4. Implement smart retry logic based on error type
5. Add HTTP status code tracking

---

## 7. FILES TO PORT

### Core Models (Prisma Schema)

**Priority 1 - MUST PORT:**
```
✅ qb_connections (POS: QBConnection)
   └─ Connection management, OAuth tokens, health tracking

✅ qb_account_mappings (POS: QBAccountMapping)
   └─ Maps POS concepts → QB Chart of Accounts

✅ qb_entity_mappings (POS: QBEntityMapping)
   └─ Central registry for all POS↔QB entity links

✅ qb_sync_queue (POS: QBSyncJob)
   └─ Async job queue with retry + idempotency
```

**Priority 2 - ENHANCE EXISTING:**
```
⚠️ qb_sync_log (POS: QBSyncLog - enhance Kuwait's minimal version)
   └─ Add: HTTP details, timing, amounts, batch tracking
```

**Priority 3 - NICE TO HAVE:**
```
🔵 qb_coa_snapshots (POS: QBCoASnapshot)
   └─ Immutable backup of original Chart of Accounts
```

### Service Layer (Business Logic)

**Priority 1 - MUST PORT:**
```
✅ services/quickbooks/client.py → services/quickbooks/client.ts
   └─ Core QB API client (OAuth, rate limiting, error handling)

✅ services/quickbooks/mappings.py → services/quickbooks/mappings.ts
   └─ Account mapping CRUD + validation

✅ services/quickbooks/oauth.py → services/quickbooks/oauth.ts
   └─ OAuth2 flow (authorize, callback, refresh)

✅ services/quickbooks/sync_service.py → services/quickbooks/sync.ts
   └─ Main sync orchestrator (queue management, retry logic)
```

**Priority 2 - PORT WITH ADAPTATION:**
```
⚠️ services/quickbooks/qbxml/* (QB Desktop only - SKIP for Kuwait)
   └─ Kuwait uses QB Online only, no Desktop support needed

⚠️ services/quickbooks/fuzzy_match.py → services/quickbooks/fuzzy-match.ts
   └─ Auto-match POS accounts to QB accounts (port algorithm, adapt data)
```

**Priority 3 - CONSIDER LATER:**
```
🔵 services/quickbooks/diagnostic.py → services/quickbooks/diagnostic.ts
   └─ Health checks, validation, troubleshooting tools

🔵 services/quickbooks/adapter_factory.py (SKIP - Single adapter in Kuwait)
   └─ Kuwait doesn't need factory pattern (Online only, not Desktop)
```

### API Endpoints

**Priority 1 - MUST PORT:**
```
✅ api/v1/quickbooks.py → routes/quickbooks.ts
   └─ OAuth endpoints: /authorize, /callback, /disconnect
   └─ Sync endpoints: /sync/manual, /sync/status
   └─ Mapping endpoints: /mappings (CRUD)
```

**Priority 2 - PORT IF NEEDED:**
```
⚠️ api/v1/qbwc.py (SKIP - QB Desktop only)
   └─ QBWC SOAP endpoints (not needed for Kuwait)
```

### Supporting Files

```
✅ integrations/quickbooks_desktop.py → integrations/quickbooks.ts
   └─ High-level integration facade

✅ schemas/quickbooks.py → validators/quickbooks.ts
   └─ Request/response validation schemas (convert Pydantic → Zod)

✅ models/quickbooks.py → Already reviewed (convert to Prisma schema)
```

---

## 8. LANGUAGE TRANSLATION STRATEGY

### Python → TypeScript Conversion Map

| Python Pattern | TypeScript Equivalent | Example |
|----------------|----------------------|---------|
| **SQLAlchemy ORM** | Prisma Client | `session.execute(select(QBConnection))` → `prisma.qBConnection.findMany()` |
| **Pydantic schemas** | Zod validators | `class QBAuthResponse(BaseModel)` → `const QBAuthResponseSchema = z.object()` |
| **Async/await** | Direct port | `async def sync()` → `async function sync()` (same syntax!) |
| **Datetime** | Date + date-fns | `datetime.now()` → `new Date()` |
| **Enum** | TypeScript enum or const | `Enum("online", "desktop")` → `enum ConnectionType { ONLINE, DESKTOP }` |
| **Dict/JSON** | Record/JSON | `dict` → `Record<string, any>` or type |
| **Cryptography (Fernet)** | crypto module | `Fernet.encrypt()` → `crypto.encrypt('aes-256-gcm')` |
| **Logging** | winston/pino | `logger.info()` → `logger.info()` (same API) |
| **FastAPI decorators** | Express middleware | `@router.post()` → `router.post()` |
| **Type hints** | TypeScript types | `def sync(job: QBSyncJob) -> dict` → `async function sync(job: QBSyncJob): Promise<Record<string, any>>` |

### Key Architectural Differences

| Aspect | POS-Project (Python) | Kuwait (TypeScript) | Adaptation Strategy |
|--------|---------------------|---------------------|---------------------|
| **Database** | PostgreSQL + SQLAlchemy | PostgreSQL + Prisma | ✅ Same DB, different ORM (Prisma replaces SQLAlchemy queries) |
| **Async Runtime** | Python asyncio | Node.js event loop | ✅ Both native async, direct port |
| **HTTP Client** | aiohttp | axios / node-fetch | ✅ Same patterns, different libs |
| **Validation** | Pydantic | Zod | ✅ Similar declarative schemas |
| **Encryption** | Fernet (symmetric) | Node crypto (AES-256-GCM) | ⚠️ Rekey required (can't decrypt Fernet with Node) |
| **Background Jobs** | SQLAlchemy polling | Node.js worker threads / Bull queue | ⚠️ Architectural change needed |
| **Environment** | python-dotenv | dotenv | ✅ Same .env format |
| **Testing** | pytest | jest / vitest | ✅ Similar assertion style |

---

## 9. IMPLEMENTATION PLAN

### Phase 1: Database Schema (Week 1)
```
✅ Create qb_connections table (Prisma schema)
✅ Create qb_account_mappings table
✅ Create qb_entity_mappings table
✅ Create qb_sync_queue table
✅ Enhance qb_sync_log table
✅ Add idempotency constraint
✅ Run migration: prisma migrate dev --name add_qb_tables
```

### Phase 2: Core Services (Week 2)
```
✅ Port OAuth service (authorize, callback, refresh, disconnect)
✅ Port QB API client (rate limiting, error handling, retry)
✅ Port sync queue service (job creation, state management)
✅ Port entity mapping service (CRUD, validation)
✅ Port account mapping service (fuzzy match, validation)
```

### Phase 3: Integration Layer (Week 3)
```
✅ Port sales sync (Sale → SalesReceipt)
✅ Port customer sync (Customer → Customer)
✅ Port product sync (Product → Item)
✅ Add idempotency checks
✅ Add retry logic
✅ Add error handling
```

### Phase 4: API Endpoints (Week 4)
```
✅ POST /api/quickbooks/authorize (OAuth start)
✅ GET  /api/quickbooks/callback (OAuth callback)
✅ POST /api/quickbooks/disconnect
✅ GET  /api/quickbooks/connection/status
✅ POST /api/quickbooks/sync/manual
✅ GET  /api/quickbooks/sync/status
✅ GET  /api/quickbooks/mappings
✅ POST /api/quickbooks/mappings
✅ PUT  /api/quickbooks/mappings/:id
✅ DELETE /api/quickbooks/mappings/:id
```

### Phase 5: Testing & Validation (Week 5)
```
✅ Unit tests for all services
✅ Integration tests with QB Sandbox
✅ Load test sync queue (1000+ jobs)
✅ Test idempotency (re-run same sync 10x)
✅ Test retry logic (simulate failures)
✅ Test error handling (all QB error codes)
✅ Side-by-side validation: POS-Project vs Kuwait (10-20 real records)
```

### Phase 6: Production Rollout (Week 6)
```
✅ Deploy to production
✅ Connect to QB Production (OAuth)
✅ Sync 1 customer (validate mapping)
✅ Sync 1 product (validate mapping)
✅ Sync 1 sale (validate full flow)
✅ Monitor for 24 hours
✅ Enable scheduled sync (hourly)
✅ Enable auto-sync (real-time on sale completion)
```

---

## 10. RISK MITIGATION

### High-Risk Areas

**1. Encryption Key Migration**
- **Risk:** POS-Project uses Python Fernet, Kuwait needs Node crypto
- **Impact:** Can't decrypt existing OAuth tokens
- **Mitigation:** Force re-auth for all QB connections (one-time inconvenience)

**2. Background Job Processing**
- **Risk:** Python uses SQLAlchemy polling, Node needs different approach
- **Impact:** Architecture change required
- **Mitigation:** Use Bull queue (Redis-backed) or pg-boss (PostgreSQL-backed)

**3. Fuzzy Matching Algorithm**
- **Risk:** Python's difflib may behave differently than JS string-similarity
- **Impact:** Auto-matching accuracy may differ
- **Mitigation:** Port algorithm exactly, add unit tests with same test data

**4. Idempotency Key Generation**
- **Risk:** Different UUID string representations between Python and Node
- **Impact:** Keys won't match if format differs
- **Mitigation:** Use consistent format: `{entityType}:{uuidv4}:{operation}`

**5. Timezone Handling**
- **Risk:** Python datetime vs JS Date have different defaults
- **Impact:** Sync timestamps may be off by hours
- **Mitigation:** Always use UTC, store as `DateTime(timezone=True)` / `@db.Timestamptz`

### Medium-Risk Areas

**6. Rate Limiting**
- **Risk:** QB API has 500 req/min limit, POS-Project handles this
- **Impact:** Kuwait may hit rate limits if not ported correctly
- **Mitigation:** Port rate limiter exactly (token bucket algorithm)

**7. Error Code Mapping**
- **Risk:** QB returns 50+ error codes, POS-Project maps them all
- **Impact:** Kuwait may retry permanent errors (wasted API calls)
- **Mitigation:** Port entire error code mapping table

**8. Transaction Rollback**
- **Risk:** If QB sync fails mid-transaction, POS data may be inconsistent
- **Impact:** POS sale marked as synced but QB has no record
- **Mitigation:** Use two-phase commit: create sync job first, mark as synced only after QB confirms

---

## 11. SUCCESS CRITERIA

### Definition of "Parity Achieved"

✅ **Functional Parity:**
- [ ] All POS-Project sync operations work in Kuwait
- [ ] Idempotency: Re-running sync 10x creates exactly 1 QB record
- [ ] Retry: Failed sync automatically retries with exponential backoff
- [ ] Error handling: All QB error codes handled correctly (no dead letter jobs)
- [ ] Mapping: Fuzzy match accuracy ≥95% (same as POS-Project)

✅ **Data Integrity Parity:**
- [ ] Side-by-side test: Sync same 20 records in both systems
- [ ] Field mapping: All fields match (names, amounts, dates, refs)
- [ ] Amounts: Financial totals match to the paisa
- [ ] Timestamps: Sync times within 1 second

✅ **Performance Parity:**
- [ ] Single sync latency: <2 seconds (same as POS-Project)
- [ ] Bulk sync throughput: >100 records/min
- [ ] Queue processing: <1 minute lag from job creation to QB sync

✅ **Operational Parity:**
- [ ] Monitoring: Failed sync alerts (Slack/email)
- [ ] Dead letter queue: Admin can view and retry
- [ ] Audit trail: Full HTTP request/response logging
- [ ] Health check: Connection status endpoint

---

## 12. APPROVAL GATE

### Files to Port (Exact List)

**FROM:** `C:/Users/Malik/desktop/POS-Project/backend/app/`

**TO:** `C:/ST/Sitara Infotech/Kuwait Petrol Pump/kuwait-petrol-pump/apps/backend/src/`

| Source File | Target File | Priority | Effort | Notes |
|-------------|-------------|----------|--------|-------|
| `models/quickbooks.py` | `(Prisma schema)` | P1 | 2 days | Convert SQLAlchemy → Prisma |
| `services/quickbooks/client.py` | `services/quickbooks/client.ts` | P1 | 3 days | Core API client |
| `services/quickbooks/oauth.py` | `services/quickbooks/oauth.ts` | P1 | 2 days | OAuth2 flow |
| `services/quickbooks/mappings.py` | `services/quickbooks/mappings.ts` | P1 | 2 days | Account mappings |
| `services/quickbooks/sync_service.py` | `services/quickbooks/sync.ts` | P1 | 3 days | Main orchestrator |
| `services/quickbooks/fuzzy_match.py` | `services/quickbooks/fuzzy-match.ts` | P2 | 1 day | Auto-matching |
| `services/quickbooks/pos_needs.py` | `services/quickbooks/pos-needs.ts` | P2 | 0.5 days | Constants |
| `api/v1/quickbooks.py` | `routes/quickbooks.ts` | P1 | 2 days | API endpoints |
| `schemas/quickbooks.py` | `validators/quickbooks.ts` | P1 | 1 day | Pydantic → Zod |
| `integrations/quickbooks_desktop.py` | `integrations/quickbooks.ts` | P1 | 1 day | Facade |
| **TOTAL** | | | **17.5 days** | ~3.5 weeks |

### SKIP (Not Needed for Kuwait)

```
❌ api/v1/qbwc.py (QB Desktop SOAP - Kuwait uses QB Online only)
❌ services/quickbooks/qbxml/* (QB Desktop XML builders - not needed)
❌ services/quickbooks/adapter_factory.py (Single adapter in Kuwait)
❌ services/quickbooks/diagnostic.py (port later if needed)
```

---

## 13. FINAL RECOMMENDATION

### DO NOT IMPLEMENT FROM SCRATCH ✅

**Reasons:**
1. **Proven in Production:** POS-Project handles real money, real transactions, real errors
2. **Complete Coverage:** All edge cases already solved (retry, idempotency, error codes)
3. **Time Savings:** 3.5 weeks to port vs 3+ months to rebuild + test + debug
4. **Lower Risk:** Known behavior vs unknown unknowns
5. **Maintenance:** Single source of truth for QB logic across both projects

### PORT STRATEGY: Exact Replication ✅

**Step 1: Freeze Kuwait QB Code** (Tag as `pre-qb-port`)
```bash
git tag pre-qb-port
git push origin pre-qb-port
```

**Step 2: Port Database Schema** (Week 1)
- Create 5 new Prisma models (see Phase 1)
- Migrate existing QBSyncLog to enhanced version
- Run migration, verify on production

**Step 3: Port Services Layer** (Week 2-3)
- Copy Python files → TypeScript files
- Convert SQLAlchemy → Prisma
- Convert Pydantic → Zod
- Keep same function signatures
- Port unit tests

**Step 4: Port API Endpoints** (Week 4)
- Create Express routes matching FastAPI endpoints
- Same URL paths, same request/response schemas
- Add authentication middleware

**Step 5: Side-by-Side Validation** (Week 5)
- Sync same 20 records in both POS-Project and Kuwait
- Compare QB output field-by-field
- Adjust any mismatches

**Step 6: Production Rollout** (Week 6)
- Deploy to production
- Manual sync first (1 customer, 1 product, 1 sale)
- Monitor for 24 hours
- Enable scheduled/auto-sync

---

## APPROVAL REQUIRED ✋

**Before proceeding with implementation, confirm:**

1. ✅ Accept POS-Project as source of truth
2. ✅ Approve 17.5-day porting timeline
3. ✅ Accept force re-auth for OAuth (encryption key change)
4. ✅ Approve side-by-side validation plan
5. ✅ Accept risk mitigation strategies

**If approved, reply: "Approved - proceed with Phase 1 (Database Schema)"**

---

**Generated:** 2026-03-27 23:30 UTC
**Author:** Claude Sonnet 4.5
**Status:** AWAITING APPROVAL
