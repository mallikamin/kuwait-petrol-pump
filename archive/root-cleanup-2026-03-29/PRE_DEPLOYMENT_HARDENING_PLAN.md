# Pre-Deployment Hardening Plan
## Kuwait Petrol Pump POS - Sprint 1 Security Audit

**Date**: 2026-03-28
**Status**: CRITICAL ISSUES IDENTIFIED - Must Fix Before Deploy

---

## 🚨 CRITICAL SECURITY ISSUES FOUND

### Issue #1: No Authentication on Sync Endpoints ❌ BLOCKING
**File**: `apps/backend/src/modules/sync/sync.routes.ts`

**Current State**:
```typescript
router.post('/queue', SyncController.syncQueue);  // NO AUTH
router.get('/status', SyncController.getSyncStatus);  // NO AUTH
router.post('/retry', SyncController.retryFailed);  // NO AUTH
```

**Risk**: Any unauthenticated user can:
- Upload malicious sales to any organization
- Query sync status of other users
- Retry failed syncs for other users

**Fix Required**: Add `authenticate` middleware to all routes

---

### Issue #2: Global Unique Constraints (Cross-Tenant Data Leak) ❌ BLOCKING
**File**: `packages/database/prisma/schema.prisma`

**Current State**:
- `User.username` → `@unique` (globally unique across all organizations)
- `Sale.offlineQueueId` → `@unique` (globally unique)
- `MeterReading.offlineQueueId` → `@unique` (globally unique)

**Risk**:
1. **User collision**: Organization A can't create user "admin" if Organization B already has it
2. **Offline queue collision**: Two organizations generate same UUID → sync fails for one
3. **Data leak**: Error messages might reveal existence of entities in other organizations

**Fix Required**: Change to tenant-scoped uniqueness:
- `@@unique([organizationId, username])`
- `@@unique([branchId, offlineQueueId])` (branch implies organization)

---

### Issue #3: No Tenant Validation in Sync Service ❌ BLOCKING
**File**: `apps/backend/src/modules/sync/sync.service.ts`

**Current State**:
```typescript
await prisma.sale.create({
  data: {
    branchId: queuedSale.branchId,  // ← Trusts client input!
    customerId: queuedSale.customerId,  // ← No validation!
    // ...
  }
});
```

**Risk**: Malicious user can:
- Insert sales into another organization's branch
- Reference another organization's customers
- Manipulate shift instances of other organizations

**Fix Required**: Validate ALL foreign keys belong to user's organization before write

---

### Issue #4: Sensitive Data in Logs ⚠️ MEDIUM
**File**: `apps/backend/src/modules/sync/sync.service.ts`

**Current State**:
```typescript
console.log(`✅ Synced sale: ${queuedSale.offlineQueueId}`);
console.error(`❌ Failed to sync sale ${queuedSale.offlineQueueId}:`, error);
```

**Risk**: Production logs contain business-sensitive identifiers

**Fix Required**: Use structured logger (Winston) with log levels, sanitize PII

---

## 📋 HARDENING CHECKLIST

### A) Multi-Tenant Safety (BLOCKING)

- [ ] **A1**: Fix User.username uniqueness → `@@unique([organizationId, username])`
- [ ] **A2**: Fix Sale.offlineQueueId uniqueness → `@@unique([branchId, offlineQueueId])`
- [ ] **A3**: Fix MeterReading.offlineQueueId uniqueness → `@@unique([nozzleId, offlineQueueId])`
- [ ] **A4**: Add authentication middleware to sync routes
- [ ] **A5**: Add tenant validation to sync.service.ts (validate branchId belongs to user's org)
- [ ] **A6**: Add tenant validation for customerId references
- [ ] **A7**: Add tenant validation for shiftInstanceId references
- [ ] **A8**: Create migration for uniqueness constraint changes
- [ ] **A9**: Test migration on dev database (rollback + apply)
- [ ] **A10**: Update sync.types.ts to remove client-provided organizationId (derive from JWT)

### B) Security & Architecture (BLOCKING)

- [ ] **B1**: Add rate limiting to sync endpoints (100 req/min per user)
- [ ] **B2**: Replace console.log with Winston logger
- [ ] **B3**: Add input validation (Zod schemas) for sync payloads
- [ ] **B4**: Verify idempotency under concurrent requests (add test)
- [ ] **B5**: Add audit logging for sync operations
- [ ] **B6**: Verify no SQL injection vectors (Prisma protects, but verify raw queries)
- [ ] **B7**: Add CSP headers for API responses
- [ ] **B8**: Verify CORS configuration is not overly permissive

### C) Scale for "100 Pumps" (IMPORTANT)

- [ ] **C1**: Add composite index: `sales(organizationId, syncStatus, lastSyncAttempt)`
- [ ] **C2**: Add composite index: `sales(branchId, saleDate, syncStatus)`
- [ ] **C3**: Add composite index: `meter_readings(organizationId, syncStatus, lastSyncAttempt)`
- [ ] **C4**: Document load assumptions (100 pumps × 500 sales/day = 50K sales/day)
- [ ] **C5**: Add pagination to GET /api/sync/status (limit 100 records)
- [ ] **C6**: Add batch size limits to POST /api/sync/queue (max 1000 records)
- [ ] **C7**: Add connection pooling config for Prisma (pool size 10-20)
- [ ] **C8**: Document expected memory usage (estimate 2GB for 100 pumps)

### D) Deployment Evidence (MANDATORY)

- [ ] **D1**: Run backend build, capture output
- [ ] **D2**: Run unit tests, capture output
- [ ] **D3**: Create migration files for schema changes
- [ ] **D4**: Document rollback plan for each migration
- [ ] **D5**: Create Go/No-Go decision matrix
- [ ] **D6**: Update REQUIREMENTS_TRACE_MATRIX.md

---

## 🔧 IMPLEMENTATION PLAN

### Phase 1: Database Schema Fixes (30 min)
1. Update `schema.prisma` with tenant-scoped uniqueness
2. Generate migration: `npx prisma migrate dev --name tenant-scoped-uniqueness`
3. Test migration rollback
4. Document migration in DEPLOYMENT_CHECKLIST.md

### Phase 2: Authentication & Authorization (20 min)
1. Update `sync.routes.ts` with authenticate middleware
2. Add role checks (cashier, operator, manager can sync)
3. Test authentication with expired/invalid tokens

### Phase 3: Tenant Validation Service (40 min)
1. Create `validateTenantAccess` helper function
2. Update `sync.service.ts` to validate branchId, customerId, etc.
3. Add unit tests for cross-tenant access attempts
4. Verify error messages don't leak tenant info

### Phase 4: Logging & Monitoring (15 min)
1. Replace console.log with Winston
2. Configure log levels (info, warn, error)
3. Sanitize PII from logs
4. Add structured logging for sync operations

### Phase 5: Performance Indexes (10 min)
1. Add composite indexes to schema
2. Generate migration
3. Document index purposes

### Phase 6: Testing & Verification (30 min)
1. Run all unit tests
2. Create cross-tenant attack test
3. Verify migration applies cleanly
4. Document test results

---

## 🎯 SUCCESS CRITERIA

Before deployment, ALL these must be TRUE:

✅ **Security**:
- [ ] All sync endpoints require authentication
- [ ] No cross-tenant data access possible
- [ ] No sensitive data in logs
- [ ] Rate limiting configured

✅ **Multi-Tenancy**:
- [ ] Username scoped to organization
- [ ] offlineQueueId scoped to branch/nozzle
- [ ] All FK validations enforce tenant boundaries
- [ ] Migrations tested (apply + rollback)

✅ **Scale**:
- [ ] Indexes support 50K+ sales/day queries
- [ ] Pagination prevents large result sets
- [ ] Batch size limits prevent memory issues
- [ ] Connection pooling configured

✅ **Testing**:
- [ ] Unit tests pass (11/11)
- [ ] Cross-tenant attack test fails (security working)
- [ ] Integration test plan documented
- [ ] Load test assumptions documented

---

## 📊 ESTIMATED TIMELINE

- **Phase 1-6**: 2.5 hours (developer time)
- **Testing**: 30 minutes
- **Documentation**: 30 minutes
- **Total**: ~3.5 hours

**Recommended**: Complete ALL phases before staging deployment

---

## 🚦 GO/NO-GO DECISION FRAMEWORK

| Category | Criteria | Current Status | Target |
|----------|----------|----------------|--------|
| **Security** | Auth required on all endpoints | ❌ FAIL | ✅ PASS |
| **Security** | No cross-tenant access | ❌ FAIL | ✅ PASS |
| **Security** | No PII in logs | ⚠️ PARTIAL | ✅ PASS |
| **Multi-Tenancy** | Scoped uniqueness | ❌ FAIL | ✅ PASS |
| **Multi-Tenancy** | FK validation | ❌ FAIL | ✅ PASS |
| **Scale** | Indexes for 100 pumps | ⚠️ PARTIAL | ✅ PASS |
| **Scale** | Batch size limits | ❌ MISSING | ✅ PASS |
| **Architecture** | Clean separation | ✅ PASS | ✅ PASS |
| **Testing** | Unit tests pass | ✅ PASS | ✅ PASS |
| **Testing** | Security tests exist | ❌ MISSING | ✅ PASS |

**Current Overall**: ❌ **NO-GO** (3 blocking failures)

**After Hardening**: ✅ **GO** (all criteria met)

---

## 📝 NEXT STEPS

1. **Immediate**: Start Phase 1 (schema fixes)
2. **Before commit**: Complete Phases 1-6
3. **Before staging**: Run full test suite
4. **Before production**: 48-hour staging soak test

**Estimated completion**: 2026-03-28 EOD

---

**This document will be updated as each phase completes.**
