# QuickBooks Integration - Financial Safety Rules

**Status**: ✅ Implemented in Schema (2026-03-28)
**Priority**: CRITICAL - HIGH-RISK FINANCIAL INFRASTRUCTURE
**Policy**: NON-NEGOTIABLE - No production write path until ALL controls verified

---

## 🚨 Core Principle

> **QuickBooks integration is HIGH-RISK FINANCIAL INFRASTRUCTURE**
> One bug can corrupt accounting data across entire organization
> GREED-DRIVEN CAUTION: Treat every sync as potentially destructive

---

## 8 Non-Negotiable Financial Safety Rules

### ✅ Rule 1: Read-Only First, Writes Behind Manual Approval

**Schema Implementation:**
```prisma
model QBConnection {
  syncMode         String  @default("READ_ONLY")        // 'READ_ONLY' | 'WRITE_ENABLED'
  globalKillSwitch Boolean @default(false)              // Emergency stop all syncs
  approvalRequired Boolean @default(true)               // Require manual approval for write batches
}

model QBSyncQueue {
  approvalStatus String    @default("pending_approval") // 'pending_approval' | 'approved' | 'rejected'
  approvedBy     String?                               // User who approved the write operation
  approvedAt     DateTime?                             // When approval granted
}
```

**Enforcement Logic (Code Layer):**
1. **Connection Defaults to READ_ONLY**: New connections start in read-only mode
2. **Admin-Only Write Enable**: Only organization admins can flip `syncMode` to `WRITE_ENABLED`
3. **Batch Approval Required**: Even with WRITE_ENABLED mode, individual batches need approval if `approvalRequired = true`
4. **Global Kill Switch**: Setting `globalKillSwitch = true` blocks ALL syncs immediately (emergency stop)

**Frontend UI:**
- ⚠️ Warning banner when switching to WRITE_ENABLED mode
- Manual "Approve Sync Batch" button for pending write operations
- Emergency "STOP ALL SYNCS" button (sets kill switch)

---

### ✅ Rule 2: Never Overwrite, Only Append + Version

**Schema Implementation:**
```prisma
model QBSyncQueue {
  idempotencyKey String? @unique                        // Prevents duplicate operations
  batchId        String?                               // Groups related operations
  syncVersion    Int                                   // Incremental version tracking
}

model QBEntitySnapshot {
  syncVersion Int     @default(1)                      // Entity version tracking
  syncHash    String?                                  // SHA-256 for change detection
}
```

**Enforcement Logic:**
1. **Idempotency Key Format**: `{entity_type}:{local_id}:{operation}:{version}` (e.g., `sale:abc123:create_receipt:1`)
2. **Version Increment Only**: Every sync increments version, never overwrites existing version
3. **Hash-Based Change Detection**: Only sync if `syncHash` differs from last snapshot
4. **Append-Only Financial Records**: No DELETE operations on Sale/Payment records (soft-delete only)

**Example:**
```javascript
// WRONG - Overwrite existing
await updateQBInvoice(invoiceId, newData);

// RIGHT - Append new version
const newVersion = lastVersion + 1;
await createQBSyncQueue({
  entityId: saleId,
  idempotencyKey: `sale:${saleId}:update_receipt:${newVersion}`,
  payload: { ...newData, version: newVersion }
});
```

---

### ✅ Rule 3: Immutable Audit Trail

**Schema Implementation:**
```prisma
model QBSyncLog {
  id             String   @id @default(uuid())
  // Full request/response metadata (redact tokens/PII)
  requestHeaders  Json?                                // HTTP headers (tokens redacted)
  requestBody     Json?                                // Request payload
  responseStatus  Int?                                 // HTTP status code
  responseBody    Json?                                // Full QB API response
  errorDetail     Json?                                // Complete error object if failed

  // Timing for performance analysis
  durationMs Int?

  // Financial audit
  amountCents Int?                                     // For quick financial audit
  batchId     String?                                  // Correlation ID for related operations

  createdAt   DateTime @default(now())                // Append-only timestamp
}
```

**Enforcement Logic:**
1. **No DELETE on sync logs**: Table has no delete operations (append-only)
2. **No UPDATE on sync logs**: Once written, never modified (immutable)
3. **Full Metadata Capture**:
   - Complete request/response JSON (with token redaction)
   - HTTP status codes and error details
   - Timing metrics for every operation
4. **Correlation IDs**: `batchId` links all operations in a sync batch
5. **Financial Audit Trail**: `amountCents` allows quick reconciliation queries

**Redaction Rules:**
```javascript
// Before logging
const redactedHeaders = {
  ...headers,
  'Authorization': '[REDACTED]',
  'Set-Cookie': '[REDACTED]'
};
```

---

### ✅ Rule 4: Backups Before Every Sync Window

**Schema Implementation:**
```prisma
model QBSyncQueue {
  checkpointId String? @map("checkpoint_id")           // DB backup checkpoint before execution
}
```

**Enforcement Logic:**

**Automated Daily Backups:**
```bash
# Cron: Daily at 3am
0 3 * * * /root/kuwait-backup.sh
```

**Pre-Sync Checkpoint:**
```javascript
async function executeWriteBatch(batchId) {
  // 1. Create pre-sync checkpoint
  const checkpointId = await createDBCheckpoint();

  // 2. Link checkpoint to batch
  await db.qbSyncQueue.updateMany({
    where: { batchId },
    data: { checkpointId }
  });

  // 3. Execute sync operations
  await processSyncBatch(batchId);

  // 4. Verify success, else restore from checkpoint
  if (anyFailures) {
    await restoreFromCheckpoint(checkpointId);
  }
}
```

**Backup Storage:**
- **Primary**: On-server `/root/backups/kuwait-YYYYMMDD-HHMMSS.sql.gz`
- **Offsite**: Upload to object storage (DigitalOcean Spaces or S3)
- **Retention**: 30 days rolling (daily cleanup)

**Weekly Restore Test:**
```bash
# Test backup integrity every Sunday
0 4 * * 0 /root/test-restore.sh
```

---

### ✅ Rule 5: QB Fallback Snapshots

**Schema Implementation:**
```prisma
model QBEntitySnapshot {
  id String @id @default(uuid())

  // QB entity identification
  qbEntityType String                                  // 'Customer' | 'Item' | 'Invoice' | 'Payment'
  qbEntityId   String                                  // QuickBooks ID (not our UUID)
  qbEntityName String                                  // For quick reference

  // Local entity mapping
  localEntityType String?                             // 'customer' | 'product' | 'sale'
  localEntityId   String?                             // Our local UUID

  // Full QB entity data (immutable snapshot)
  snapshotData Json                                    // Complete QB entity JSON response
  syncVersion  Int     @default(1)                    // Incremental version tracking
  syncHash     String?                                // SHA-256 of snapshot data

  // Snapshot metadata
  snapshotType String                                  // 'pre_sync' | 'post_sync' | 'manual' | 'scheduled'
  snapshotBy   String?                                // User ID if manual snapshot
  snapshotAt   DateTime

  // Retention
  expiresAt DateTime?                                 // Null = keep forever
}
```

**Snapshot Strategy:**

**Pre-Sync Snapshot (Before Enabling Auto-Sync):**
```bash
# Export key QB entities before first write operation
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/snapshot/export \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "entities": ["Customer", "Item", "Invoice", "Payment"],
    "snapshotType": "pre_sync",
    "notes": "Pre-production sync baseline"
  }'
```

**Scheduled Snapshots:**
```javascript
// Daily QB entity snapshot (cron: 2am)
async function createScheduledSnapshot() {
  const entities = ['Customer', 'Item', 'Invoice', 'Payment'];

  for (const entityType of entities) {
    const qbData = await fetchAllQBEntities(entityType);

    for (const entity of qbData) {
      await db.qbEntitySnapshot.create({
        data: {
          qbEntityType: entityType,
          qbEntityId: entity.Id,
          qbEntityName: entity.Name || entity.DisplayName,
          snapshotData: entity,
          syncHash: sha256(JSON.stringify(entity)),
          snapshotType: 'scheduled',
          snapshotAt: new Date()
        }
      });
    }
  }
}
```

**Replay from Snapshot:**
```javascript
// Restore local DB from last known-good QB snapshot
async function replayFromSnapshot(snapshotDate) {
  const snapshots = await db.qbEntitySnapshot.findMany({
    where: {
      snapshotAt: { lte: snapshotDate },
      snapshotType: { in: ['post_sync', 'scheduled'] }
    },
    orderBy: { snapshotAt: 'desc' }
  });

  // Rebuild local entities from QB snapshots
  for (const snapshot of snapshots) {
    await syncQBEntityToLocal(snapshot.snapshotData);
  }
}
```

---

### ✅ Rule 6: Strict Blast-Radius Controls

**Schema Implementation:**
```prisma
model QBConnection {
  organizationId String       @unique                  // Single organization per connection
  realmId        String                                // Locked QB company ID

  @@unique([organizationId, realmId])                 // Prevent cross-company
}

model QBSyncQueue {
  organizationId String                                // Enforced on every operation

  @@index([organizationId, status])                   // Fast org-scoped queries
}
```

**Enforcement Logic:**

**Company ID Lock:**
```javascript
// At connection creation, lock to specific QB company
async function connectQuickBooks(authCode) {
  const qbCompany = await getQBCompanyInfo(authCode);

  // Check if another org already connected to this company
  const existing = await db.qbConnection.findFirst({
    where: { realmId: qbCompany.realmId }
  });

  if (existing) {
    throw new Error('This QuickBooks company is already connected to another organization');
  }

  // Lock connection
  await db.qbConnection.create({
    data: {
      organizationId: user.organizationId,
      realmId: qbCompany.realmId,
      companyName: qbCompany.companyName
    }
  });
}
```

**Rate Limiting:**
```javascript
// Per-entity rate limits (prevent QB API throttling)
const RATE_LIMITS = {
  Customer: { maxPerMinute: 30, maxPerHour: 500 },
  Item: { maxPerMinute: 30, maxPerHour: 500 },
  Invoice: { maxPerMinute: 20, maxPerHour: 300 },
  Payment: { maxPerMinute: 20, maxPerHour: 300 }
};

// Circuit breaker on repeated failures
async function executeQBOperation(operation) {
  const failureCount = await getRecentFailureCount(operation.entityType);

  if (failureCount >= 5) {
    // Circuit breaker OPEN - stop syncing this entity type
    throw new Error(`Circuit breaker open for ${operation.entityType} - too many failures`);
  }

  // Execute operation
  // ...
}
```

**Cross-Company Write Block:**
```javascript
// Middleware: Verify org matches connection realm
async function verifyQBWritePermission(req, res, next) {
  const connection = await db.qbConnection.findUnique({
    where: { organizationId: req.user.organizationId }
  });

  if (req.body.realmId !== connection.realmId) {
    return res.status(403).json({
      error: 'Cross-company write blocked',
      allowed: connection.realmId,
      attempted: req.body.realmId
    });
  }

  next();
}
```

---

### ✅ Rule 7: Secrets/Security Hardening

**Schema Implementation:**
```prisma
model QBConnection {
  // OAuth2 tokens (encrypted with Node crypto AES-256-GCM)
  accessTokenEncrypted  String?                       // Encrypted at rest
  refreshTokenEncrypted String?                       // Encrypted at rest
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
}
```

**Encryption Implementation:**
```javascript
// AES-256-GCM encryption for QB tokens
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.QB_TOKEN_ENCRYPTION_KEY; // 32 bytes
const ALGORITHM = 'aes-256-gcm';

function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptToken(encryptedToken) {
  const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

**Secret Rotation Process:**
```bash
# Quarterly encryption key rotation (Q1, Q2, Q3, Q4)
1. Generate new encryption key: openssl rand -base64 32
2. Update QB_TOKEN_ENCRYPTION_KEY_NEW in .env
3. Run migration script:
   - Decrypt all tokens with old key
   - Re-encrypt with new key
   - Update all QBConnection records
4. Swap: QB_TOKEN_ENCRYPTION_KEY = QB_TOKEN_ENCRYPTION_KEY_NEW
5. Delete QB_TOKEN_ENCRYPTION_KEY_NEW
6. Document key rotation in audit log
```

**Security Checklist:**
- ✅ Tokens encrypted at rest (AES-256-GCM)
- ✅ Encryption keys in .env (never in code)
- ✅ Tokens never logged (redacted in audit trail)
- ✅ Least-privilege access (only QB sync service)
- ✅ No tokens in git history (pre-commit hook)
- ✅ Quarterly key rotation process documented

---

### ✅ Rule 8: Rollback Plan

**Schema Implementation:**
```prisma
model QBConnection {
  globalKillSwitch Boolean @default(false)             // Emergency stop
}

model QBSyncQueue {
  batchId             String?                         // Group related operations
  checkpointId        String?                         // DB backup before execution
  replayableFromBatch String?                         // Reference batch for replay
}
```

**Kill Switch Implementation:**
```javascript
// Emergency stop - blocks ALL sync operations
async function executeKillSwitch() {
  await db.qbConnection.updateMany({
    data: { globalKillSwitch: true }
  });

  await db.qbSyncQueue.updateMany({
    where: { status: 'pending' },
    data: { status: 'cancelled' }
  });

  console.log('🚨 KILL SWITCH ACTIVATED - All QB syncs stopped');
}

// Check kill switch before every operation
async function checkKillSwitch(organizationId) {
  const connection = await db.qbConnection.findUnique({
    where: { organizationId }
  });

  if (connection.globalKillSwitch) {
    throw new Error('QB sync disabled - kill switch active');
  }
}
```

**Replay from Checkpoint:**
```javascript
// Restore DB and replay sync operations from last successful checkpoint
async function replayFromCheckpoint(checkpointId) {
  // 1. Restore database from checkpoint
  await restoreDBFromCheckpoint(checkpointId);

  // 2. Find last successful batch before checkpoint
  const lastSuccessfulBatch = await db.qbSyncQueue.findFirst({
    where: {
      checkpointId,
      status: 'completed'
    },
    orderBy: { completedAt: 'desc' }
  });

  // 3. Re-queue all operations after last successful batch
  const failedOperations = await db.qbSyncQueue.findMany({
    where: {
      batchId: { gt: lastSuccessfulBatch.batchId },
      status: { in: ['pending', 'processing', 'failed'] }
    }
  });

  // 4. Reset to pending with incremented retry count
  await db.qbSyncQueue.updateMany({
    where: { id: { in: failedOperations.map(op => op.id) } },
    data: {
      status: 'pending',
      retryCount: { increment: 1 },
      errorMessage: 'Reset by checkpoint replay'
    }
  });

  console.log(`✅ Replayed ${failedOperations.length} operations from checkpoint ${checkpointId}`);
}
```

**Runbook - Disaster Recovery:**

**Scenario 1: QB sync corrupted local sales data**
```bash
# 1. STOP ALL SYNCS
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/kill-switch \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. Restore from pre-sync checkpoint
ssh root@kuwaitpos-server
cd /root/backups
# Find checkpoint before corruption
ls -lt kuwait-*.sql.gz
# Restore
gunzip -c kuwait-20260327-140000.sql.gz | docker exec -i kuwait-postgres psql -U postgres kuwait_pos

# 3. Verify data integrity
curl https://kuwaitpos.duckdns.org/api/reports/sales/daily?date=2026-03-27

# 4. Replay sync from checkpoint
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/replay-checkpoint \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"checkpointId": "checkpoint-20260327-140000"}'

# 5. Re-enable sync (manual review first)
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/kill-switch/disable \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Scenario 2: QB API error corrupted QuickBooks invoices**
```bash
# 1. STOP ALL SYNCS
# (same as Scenario 1)

# 2. Export last known-good QB snapshot
curl -X GET https://kuwaitpos.duckdns.org/api/quickbooks/snapshot/export?date=2026-03-27 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -o qb-snapshot-20260327.json

# 3. Manual QB restore (via QuickBooks UI or QB API)
# - Delete corrupted invoices
# - Re-import from snapshot JSON

# 4. Sync local DB from QB (read-only)
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/sync-from-qb \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"entities": ["Invoice"], "mode": "READ_ONLY"}'

# 5. Verify reconciliation
curl -X GET https://kuwaitpos.duckdns.org/api/quickbooks/reconciliation/report
```

---

## 🎯 Pre-Production Checklist

Before enabling `syncMode = WRITE_ENABLED`:

- [ ] **Rule 1**: Verify read-only mode works (test QB data fetch)
- [ ] **Rule 2**: Test idempotency key enforcement (duplicate operations blocked)
- [ ] **Rule 3**: Verify audit logs capture full request/response
- [ ] **Rule 4**: Daily backups running (check cron job)
- [ ] **Rule 5**: Create pre-sync QB snapshot (export key entities)
- [ ] **Rule 6**: Test organization isolation (cross-company writes blocked)
- [ ] **Rule 7**: Verify token encryption (decrypt test succeeds)
- [ ] **Rule 8**: Test kill switch (all syncs stop immediately)
- [ ] **Weekly restore test**: Backup integrity verified
- [ ] **Runbook documented**: Team knows disaster recovery steps

---

## 🚀 Production Deployment Workflow

### Phase 1: Read-Only Testing (2 weeks)
- Deploy with `syncMode = READ_ONLY`
- Fetch QB data: Customers, Items, Invoices, Payments
- Compare QB vs local data (detect mismatches)
- Fix any data inconsistencies before write operations

### Phase 2: Manual Write Testing (1 week)
- Switch to `syncMode = WRITE_ENABLED`
- Keep `approvalRequired = true`
- Create 10 test sales
- Manually approve each sync batch
- Verify QB invoices match local sales

### Phase 3: Automated Write (Production)
- Set `approvalRequired = false` (optional - client decision)
- Monitor sync logs daily
- Weekly reconciliation reports
- Monthly QB snapshot exports

---

## 📊 Monitoring & Alerts

**Daily Health Check:**
```sql
-- Failed syncs in last 24 hours
SELECT COUNT(*) as failed_count, error_code, error_message
FROM qb_sync_log
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY error_code, error_message
ORDER BY failed_count DESC;

-- Sync batch approval backlog
SELECT COUNT(*) as pending_batches
FROM qb_sync_queue
WHERE approval_status = 'pending_approval'
  AND created_at < NOW() - INTERVAL '1 hour';
```

**Alert Thresholds:**
- 🔴 **Critical**: Kill switch activated
- 🔴 **Critical**: >10 failed syncs in 1 hour
- 🟠 **Warning**: >50 pending approvals
- 🟠 **Warning**: Daily backup failed
- 🟡 **Info**: Sync duration >5s (performance issue)

---

## 🔐 Access Control

**Who Can:**
- **Enable WRITE_ENABLED mode**: Organization admins only
- **Approve sync batches**: Managers + Admins
- **Activate kill switch**: Admins only
- **Replay from checkpoint**: Admins only
- **View sync logs**: All authenticated users (org-scoped)

---

## 📝 Audit Trail Queries

**Financial reconciliation:**
```sql
-- Daily sales vs QB invoices
SELECT
  DATE(s.created_at) as sale_date,
  COUNT(s.id) as sales_count,
  SUM(s.total_amount) as sales_total,
  COUNT(qsl.id) as qb_synced_count,
  SUM(qsl.amount_cents / 100.0) as qb_synced_total
FROM sales s
LEFT JOIN qb_sync_log qsl ON qsl.entity_id = s.id AND qsl.entity_type = 'sale' AND qsl.status = 'success'
WHERE s.created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(s.created_at)
ORDER BY sale_date DESC;
```

**Sync performance:**
```sql
-- Average sync duration by entity type
SELECT
  entity_type,
  COUNT(*) as total_syncs,
  AVG(duration_ms) as avg_duration_ms,
  MAX(duration_ms) as max_duration_ms
FROM qb_sync_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY entity_type
ORDER BY avg_duration_ms DESC;
```

---

## 🧪 Testing Scenarios

Before production deployment, test these scenarios:

1. **Duplicate Sale Sync**: Create same sale twice → 2nd blocked by idempotency key
2. **Cross-Company Write**: Try to sync to different realmId → Blocked
3. **Kill Switch**: Activate kill switch → All pending syncs cancelled
4. **Checkpoint Restore**: Corrupt data → Restore from checkpoint → Data intact
5. **QB API Failure**: Simulate 500 error → Retry with exponential backoff
6. **Token Expiry**: Expire access token → Automatic refresh token flow
7. **Rate Limit**: Send 100 requests/min → Circuit breaker opens after failures

---

**END OF FINANCIAL SAFETY RULES DOCUMENTATION**

**Last Updated**: 2026-03-28
**Schema Version**: Track A + Financial Safety Controls
**Status**: ✅ Schema Complete, Code Layer Pending Implementation
