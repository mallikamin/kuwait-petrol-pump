# Migration Plan: QB Safety Track A

**Date**: 2026-03-28
**Target**: Production DB at kuwaitpos.duckdns.org
**Risk Level**: HIGH (modifying live production database)

---

## Problem

- Project was bootstrapped with `prisma db push` (no migration files)
- Production DB is live with current schema (no migration history)
- Need to add QB safety fields to production safely

---

## Solution: Baseline + Diff Migration

### Step 1: Create Baseline Migration (Capture Current State)

```bash
# This creates a migration that matches production's current schema
# WITHOUT applying it (production already has this schema)
cd packages/database
pnpm exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > migrations/BASELINE/migration.sql

# Mark this as applied (don't actually run it)
pnpm exec prisma migrate resolve --applied BASELINE
```

**Risk**: LOW - Only creates file, doesn't touch DB

---

### Step 2: Checkout Pre-QB-Safety Schema

```bash
# First, save current (QB-enhanced) schema
cp prisma/schema.prisma prisma/schema.prisma.qb-safety

# Checkout schema from last commit (before QB safety changes)
git checkout HEAD~1 -- prisma/schema.prisma

# OR manually remove QB safety fields:
# - QBConnection: syncMode, globalKillSwitch, approvalRequired
# - QBSyncQueue: batchId, checkpointId, approvalStatus, approvedBy, approvedAt, replayableFromBatch
# - QBEntitySnapshot: entire model
# - Organization: qbSnapshots relation
```

**Risk**: LOW - Just file manipulation

---

### Step 3: Create Baseline Migration from Pre-Safety Schema

```bash
# Generate baseline migration from original schema
pnpm exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > migrations/0_baseline/migration.sql

# Mark as applied (production already has this)
pnpm exec prisma migrate resolve --applied 0_baseline
```

**Risk**: LOW - Doesn't execute on DB

---

### Step 4: Restore QB Safety Schema

```bash
# Restore the QB-enhanced schema
cp prisma/schema.prisma.qb-safety prisma/schema.prisma
```

**Risk**: NONE - File copy

---

### Step 5: Generate QB Safety Migration

```bash
# This generates a migration with ONLY the QB safety changes
pnpm exec prisma migrate dev --name add_qb_safety_track_a --create-only

# Review the generated SQL in:
# migrations/YYYYMMDDHHMMSS_add_qb_safety_track_a/migration.sql
```

**Risk**: LOW - Only generates file, doesn't apply yet

**Expected Changes:**
- `ALTER TABLE qb_connections ADD COLUMN sync_mode VARCHAR(20) DEFAULT 'READ_ONLY';`
- `ALTER TABLE qb_connections ADD COLUMN global_kill_switch BOOLEAN DEFAULT false;`
- `ALTER TABLE qb_connections ADD COLUMN approval_required BOOLEAN DEFAULT true;`
- `ALTER TABLE qb_sync_queue ADD COLUMN batch_id UUID;`
- `ALTER TABLE qb_sync_queue ADD COLUMN checkpoint_id UUID;`
- `ALTER TABLE qb_sync_queue ADD COLUMN approval_status VARCHAR(20) DEFAULT 'pending_approval';`
- `ALTER TABLE qb_sync_queue ADD COLUMN approved_by UUID;`
- `ALTER TABLE qb_sync_queue ADD COLUMN approved_at TIMESTAMPTZ;`
- `ALTER TABLE qb_sync_queue ADD COLUMN replayable_from_batch UUID;`
- `CREATE TABLE qb_entity_snapshots (...);`
- `CREATE INDEX idx_qb_sync_queue_org_batch ON qb_sync_queue(organization_id, batch_id);`
- `CREATE INDEX idx_qb_sync_queue_org_approval ON qb_sync_queue(organization_id, approval_status);`
- `CREATE INDEX idx_qb_sync_queue_checkpoint ON qb_sync_queue(checkpoint_id);`
- `CREATE INDEX idx_qb_snapshot_org_entity ON qb_entity_snapshots(organization_id, qb_entity_type, qb_entity_id);`
- `CREATE INDEX idx_qb_snapshot_org_type_time ON qb_entity_snapshots(organization_id, snapshot_type, snapshot_at);`
- `CREATE INDEX idx_qb_snapshot_conn_time ON qb_entity_snapshots(connection_id, snapshot_at);`
- `CREATE INDEX idx_qb_snapshot_expires ON qb_entity_snapshots(expires_at);`

---

### Step 6: Backup Production DB

**MANDATORY Before Applying Migration**

```bash
# SSH to production server
ssh root@kuwaitpos-server

# Create pre-migration backup
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker exec kuwaitpos-postgres pg_dump -U postgres kuwait_pos | gzip > /root/backups/kuwait-pre-qb-safety-$TIMESTAMP.sql.gz

# Verify backup size (should be > 1KB)
ls -lh /root/backups/kuwait-pre-qb-safety-$TIMESTAMP.sql.gz

# Test restore (dry run)
gunzip -c /root/backups/kuwait-pre-qb-safety-$TIMESTAMP.sql.gz | head -20
```

**Risk**: NONE - Read-only operation

**Verification**: Backup file exists and is non-zero size

---

### Step 7: Apply Migration to Production

```bash
# SSH to production server
ssh root@kuwaitpos-server
cd ~/kuwait-pos/packages/database

# Apply migration (THIS MODIFIES PRODUCTION DB)
docker exec -it kuwaitpos-backend npx prisma migrate deploy

# OR from local (if DATABASE_URL points to production)
pnpm exec prisma migrate deploy
```

**Risk**: HIGH - Modifies production database

**Rollback Plan**: Restore from backup created in Step 6

---

### Step 8: Verify Migration Success

```bash
# Check migration status
docker exec -it kuwaitpos-backend npx prisma migrate status

# Expected output:
# ✓ Database schema is up to date!
# 2 migrations found in history

# Verify new fields exist
docker exec -it kuwaitpos-postgres psql -U postgres kuwait_pos -c "\d qb_connections"

# Should show:
# - sync_mode
# - global_kill_switch
# - approval_required

# Verify new table exists
docker exec -it kuwaitpos-postgres psql -U postgres kuwait_pos -c "\d qb_entity_snapshots"

# Should show full table structure
```

**Risk**: LOW - Read-only verification

**Success Criteria**:
- ✅ Migration status shows "up to date"
- ✅ New fields exist in qb_connections
- ✅ New fields exist in qb_sync_queue
- ✅ New table qb_entity_snapshots exists
- ✅ All indexes created

---

### Step 9: Health Check

```bash
# Test API health
curl https://kuwaitpos.duckdns.org/api/health

# Expected: {"status": "ok"}

# Test QB connection list (should return empty array or existing connections)
curl -X GET https://kuwaitpos.duckdns.org/api/quickbooks/connections \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Expected: [] or [{"id": "...", "syncMode": "READ_ONLY", ...}]
```

**Risk**: LOW - Read-only verification

**Success Criteria**:
- ✅ API responds 200 OK
- ✅ No 500 errors in logs
- ✅ QB connections query works

---

## Rollback Plan

If migration fails or causes issues:

```bash
# 1. Stop backend
docker compose -f docker-compose.prod.yml stop backend

# 2. Restore database from backup
gunzip -c /root/backups/kuwait-pre-qb-safety-TIMESTAMP.sql.gz | \
  docker exec -i kuwaitpos-postgres psql -U postgres kuwait_pos

# 3. Revert schema.prisma to pre-QB-safety version
git checkout HEAD~1 -- packages/database/prisma/schema.prisma

# 4. Rebuild backend with old schema
cd ~/kuwait-pos
docker compose -f docker-compose.prod.yml up -d --build backend

# 5. Verify rollback success
curl https://kuwaitpos.duckdns.org/api/health
```

**Time to Rollback**: ~5 minutes

---

## Alternative: Safe Parallel Approach

If risk is too high for production, use this safer approach:

### Option B: Create Staging Environment First

1. **Setup Staging Server**:
   - Clone production data to staging DB
   - Apply migration to staging
   - Test for 24 hours
   - If stable, apply to production

2. **Blue-Green Migration**:
   - Create new `qb_*_v2` tables with safety fields
   - Dual-write to both old and new tables
   - Verify data consistency
   - Switch reads to new tables
   - Drop old tables after 1 week

**Time**: 1 week
**Risk**: VERY LOW - Zero downtime

---

## Decision Matrix

| Approach | Risk | Downtime | Time | Recommended |
|----------|------|----------|------|-------------|
| **Direct Migration** | HIGH | 2-5 min | 30 min | ✅ YES (with backup) |
| **Staging First** | LOW | 0 min | 1 day | If no staging server |
| **Blue-Green** | VERY LOW | 0 min | 1 week | Over-engineered for this case |

**Recommendation**: **Direct Migration with Backup** (Step-by-step above)

**Rationale**:
- QB integration not yet in use (no data loss risk)
- Migration is additive only (no data deletion)
- Defaults are safe (READ_ONLY, approval_required = true)
- Fast rollback available (5 min from backup)
- Downtime acceptable during maintenance window

---

## Execution Checklist

Before running migration:

- [ ] Backup created and verified (Step 6)
- [ ] Migration SQL reviewed (Step 5)
- [ ] Rollback plan documented (above)
- [ ] Maintenance window scheduled (low-traffic time)
- [ ] Team notified of potential 5-min downtime
- [ ] Admin access to production server confirmed
- [ ] Backup retention verified (30 days)

During migration:

- [ ] Monitor logs: `docker compose -f docker-compose.prod.yml logs -f backend`
- [ ] Check DB CPU/Memory: `docker stats kuwaitpos-postgres`
- [ ] Test API after each step

After migration:

- [ ] Health check passed (Step 9)
- [ ] No errors in logs for 10 minutes
- [ ] QB endpoints tested (GET /api/quickbooks/connections)
- [ ] Document migration completion in ERROR_LOG.md

---

## Timeline

**Total Time**: ~45 minutes

1. Baseline setup: 10 minutes (Steps 1-5)
2. Backup production: 5 minutes (Step 6)
3. Apply migration: 2 minutes (Step 7)
4. Verify + health check: 5 minutes (Steps 8-9)
5. Monitor: 10 minutes
6. Documentation: 10 minutes

**Maintenance Window**: Schedule 1 hour to be safe

---

**Status**: READY TO EXECUTE
**Blocker**: None (schema validated, rollback plan ready)
**Next Action**: User approval to proceed with migration

**END OF MIGRATION PLAN**
