# Production Cutover - Exact Commands

**Generated**: 2026-03-29
**Target Server**: 64.226.65.80 (Kuwait Droplet)
**Prerequisites**: Backend deployed, PostgreSQL running, .env configured

---

## Phase 0: Pre-Cutover Verification

### 1. Backup Database
```bash
ssh root@64.226.65.80

# Create backup directory if not exists
mkdir -p /root/backups

# Manual backup before migration
docker exec kuwait-postgres pg_dump -U postgres kuwait_pos | gzip > /root/backups/pre-cutover-$(date +%Y%m%d-%H%M%S).sql.gz

# Verify backup created
ls -lh /root/backups/pre-cutover-*.sql.gz
```

### 2. Verify Current State
```bash
# Check running containers
docker compose -f docker-compose.prod.yml ps

# Check backend health
curl https://kuwaitpos.duckdns.org/api/health

# Check database connectivity
docker exec kuwait-postgres psql -U postgres kuwait_pos -c "SELECT COUNT(*) FROM organizations;"
```

---

## Phase 1: Deploy Migrations

### 1. Run Prisma Migrations
```bash
ssh root@64.226.65.80

cd ~/kuwait-pos

# Run migrations (includes QB entity mappings + sync mode updates)
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Expected output:
# ✅ 20260329200617_add_qb_entity_mappings
# ✅ 20260329220000_add_dry_run_full_sync_modes
```

### 2. Verify Migration Success
```bash
# Check qb_entity_mappings table exists
docker exec kuwait-postgres psql -U postgres kuwait_pos -c "SELECT COUNT(*) FROM qb_entity_mappings;"

# Check syncMode values updated (WRITE_ENABLED → FULL_SYNC)
docker exec kuwait-postgres psql -U postgres kuwait_pos -c "SELECT id, sync_mode FROM qb_connections LIMIT 5;"
```

---

## Phase 2: Preflight Validation

### 1. Get Admin JWT Token
```bash
# Login as admin to get JWT
curl -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "YOUR_ADMIN_PASSWORD"
  }' | jq -r '.accessToken'

# Save token to variable
export ADMIN_JWT="<paste_token_here>"
```

### 2. Run Preflight Checks
```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight | jq

# Expected response:
# {
#   "success": true,
#   "overallStatus": "ready" | "warning" | "blocked",
#   "checks": [
#     { "name": "Database Migration", "status": "pass", "message": "...", "details": {...} },
#     { "name": "Environment Variables", "status": "pass", "message": "...", "details": {...} },
#     { "name": "QuickBooks Connection", "status": "fail", "message": "...", "details": {...} },  # ← Will fail until OAuth
#     { "name": "Entity Mappings - Walk-in Customer", "status": "fail", "message": "...", "details": {...} },  # ← Will fail until mappings created
#     { "name": "Redis Connectivity", "status": "pass", "message": "...", "details": {...} }
#   ],
#   "summary": {
#     "totalChecks": 7,
#     "passed": 2,
#     "warnings": 0,
#     "failed": 5,
#     "timestamp": "2026-03-29T..."
#   }
# }
```

---

## Phase 3: QuickBooks OAuth Connection

### 1. Verify Redirect URI in Intuit App
**Manual Step** - User must log into Intuit Developer Portal:
1. Go to https://developer.intuit.com/app/developer/myapps
2. Select your app
3. Navigate to Keys & Credentials > Redirect URIs
4. Add: `https://kuwaitpos.duckdns.org/api/quickbooks/callback`
5. Save

### 2. Initiate OAuth Flow
```bash
# Get authorization URL
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/oauth/authorize | jq -r '.authorizationUrl'

# Copy URL, paste in browser
# Login to QuickBooks Online
# Authorize the app
# You will be redirected back to /callback (auto-saves tokens)
```

### 3. Verify Connection
```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/oauth/status | jq

# Expected response:
# {
#   "connected": true,
#   "connection": {
#     "companyName": "Your QB Company",
#     "realmId": "1234567890",
#     "syncMode": "READ_ONLY",  # ← Default mode after OAuth
#     "lastSyncAt": null,
#     "tokenExpiresAt": "2026-03-30T..."
#   }
# }
```

---

## Phase 4: Entity Mappings Setup

### 1. Get QuickBooks Entity IDs
**Manual Step** - User must provide QB entity IDs:
- Walk-in customer ID (from QB Customers list)
- Cash payment method ID
- Card payment method ID
- Fuel item IDs for PMG, HSD, etc.

### 2. Create Walk-in Customer Mapping
```bash
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "customer",
    "localEntityId": "walk-in",
    "localName": "Walk-in Customer",
    "qbEntityId": "QB_CUSTOMER_ID_FROM_QUICKBOOKS",
    "qbName": "Walk-in Customer"
  }' | jq
```

### 3. Create Payment Method Mappings
```bash
# Cash
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "payment_method",
    "localEntityId": "cash",
    "localName": "Cash",
    "qbEntityId": "QB_CASH_PAYMENT_METHOD_ID",
    "qbName": "Cash"
  }' | jq

# Card
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "payment_method",
    "localEntityId": "card",
    "localName": "Credit/Debit Card",
    "qbEntityId": "QB_CARD_PAYMENT_METHOD_ID",
    "qbName": "Credit Card"
  }' | jq
```

### 4. Create Fuel Item Mappings
```bash
# Get local fuel types
docker exec kuwait-postgres psql -U postgres kuwait_pos -c \
  "SELECT id, code, name FROM fuel_types;"

# Create mapping for each fuel type (example: PMG)
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "item",
    "localEntityId": "PMG_FUEL_TYPE_ID_FROM_DB",
    "localName": "Petrol (PMG)",
    "qbEntityId": "QB_PMG_ITEM_ID",
    "qbName": "Petrol"
  }' | jq

# Repeat for HSD, etc.
```

### 5. Verify All Mappings Created
```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/mappings | jq

# Expected: Array of all mappings created above
```

---

## Phase 5: Rollout Execution

### Week 1-2: READ_ONLY Mode (OAuth Validation)
```bash
# Verify current mode (should already be READ_ONLY after OAuth)
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls | jq

# Expected:
# {
#   "killSwitch": false,
#   "syncMode": "READ_ONLY"
# }

# Monitor: No QB writes, connection health only
# Action: Test OAuth refresh (wait 1 hour, check token refreshes automatically)
```

### Week 3: DRY_RUN Mode (Payload Validation)
```bash
# Enable DRY_RUN mode
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "DRY_RUN"
  }' | jq

# Verify mode updated
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls | jq

# Expected:
# {
#   "killSwitch": false,
#   "syncMode": "DRY_RUN",
#   "message": "Control updated successfully"
# }

# Create test fuel sale (triggers dry-run sync)
curl -X POST https://kuwaitpos.duckdns.org/api/fuel-sales \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzleId": "VALID_NOZZLE_ID",
    "meterReadingId": "VALID_METER_READING_ID",
    "liters": 10.5,
    "totalAmount": 100.50,
    "paymentMethod": "cash"
  }' | jq

# Check logs for dry-run decision
docker compose -f docker-compose.prod.yml logs backend | grep "\[QB_DRY_RUN\]\[DECISION\]"

# Expected log:
# [QB_DRY_RUN][DECISION] Fuel sale X dry-run: payload validated, no QB API call

# Check audit log for DRY_RUN payload
docker exec kuwait-postgres psql -U postgres kuwait_pos -c \
  "SELECT operation, status, metadata->>'payload' FROM quickbooks_audit_logs WHERE operation = 'CREATE_SALES_RECEIPT_DRY_RUN' ORDER BY created_at DESC LIMIT 1;"

# Monitor: 1 week of dry-run sales, verify all payloads valid
```

### Week 4+: FULL_SYNC Mode (Production Writes)
```bash
# Enable FULL_SYNC mode
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "FULL_SYNC"
  }' | jq

# Verify mode updated
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls | jq

# Expected:
# {
#   "killSwitch": false,
#   "syncMode": "FULL_SYNC",
#   "message": "Control updated successfully"
# }

# Create real fuel sale (triggers actual QB sync)
curl -X POST https://kuwaitpos.duckdns.org/api/fuel-sales \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "nozzleId": "VALID_NOZZLE_ID",
    "meterReadingId": "VALID_METER_READING_ID",
    "liters": 10.5,
    "totalAmount": 100.50,
    "paymentMethod": "cash"
  }' | jq

# Check logs for QB write success
docker compose -f docker-compose.prod.yml logs backend | grep "\[QB_WRITE\]\[SUCCESS\]"

# Expected log:
# [QB_WRITE][SUCCESS] Fuel sale X synced to QB: Sales Receipt ID=12345

# Verify in QuickBooks Online UI:
# 1. Go to Sales > Sales Receipts
# 2. Check for new receipt matching the sale
```

---

## Rollback Procedures

### Emergency: Activate Kill Switch
```bash
# Immediately stop all QB writes
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "killSwitch": true
  }' | jq

# Verify kill switch active
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/controls | jq

# Expected:
# {
#   "killSwitch": true,
#   "syncMode": "FULL_SYNC"  # ← Mode unchanged, but no writes will execute
# }
```

### Rollback to DRY_RUN
```bash
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "DRY_RUN"
  }' | jq
```

### Rollback to READ_ONLY
```bash
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/controls \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "syncMode": "READ_ONLY"
  }' | jq
```

### Database Restore (Last Resort)
```bash
# List backups
ls -lh /root/backups/

# Restore from backup
gunzip -c /root/backups/pre-cutover-TIMESTAMP.sql.gz | \
  docker exec -i kuwait-postgres psql -U postgres kuwait_pos

# Verify restoration
docker exec kuwait-postgres psql -U postgres kuwait_pos -c \
  "SELECT COUNT(*) FROM qb_sync_logs;"
```

---

## Monitoring Commands

### Check Sync Queue Status
```bash
docker exec kuwait-postgres psql -U postgres kuwait_pos -c \
  "SELECT status, COUNT(*) FROM qb_sync_queue GROUP BY status;"

# Expected:
#    status    | count
# -------------+-------
#  completed   |   45
#  pending     |    3
#  failed      |    0
```

### Check Recent Sync Logs
```bash
docker exec kuwait-postgres psql -U postgres kuwait_pos -c \
  "SELECT operation, status, error_message, created_at
   FROM qb_sync_logs
   ORDER BY created_at DESC
   LIMIT 10;"
```

### Check Error Classification
```bash
docker compose -f docker-compose.prod.yml logs backend | grep "\[QB_WRITE\]\[FAIL\]" | tail -20

# Look for categories: AUTH_TOKEN, VALIDATION_MAPPING, RATE_LIMIT_TRANSIENT, UNKNOWN_INTERNAL
```

### Check Preflight Status (Real-time)
```bash
# Run preflight checks anytime
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://kuwaitpos.duckdns.org/api/quickbooks/preflight | jq '.overallStatus'

# Expected: "ready" (all checks passed)
```

---

## Validation Checklist

After each phase, verify:

- [ ] **Phase 1 (Migrations)**
  - [ ] `qb_entity_mappings` table exists
  - [ ] `syncMode` values updated (no WRITE_ENABLED in DB)
  - [ ] Backup created and verified

- [ ] **Phase 2 (Preflight)**
  - [ ] Database check: PASS
  - [ ] Environment check: PASS
  - [ ] Connection check: FAIL (expected until OAuth)
  - [ ] Mappings check: FAIL (expected until mappings created)
  - [ ] Redis check: PASS

- [ ] **Phase 3 (OAuth)**
  - [ ] Redirect URI added to Intuit app
  - [ ] OAuth flow completed successfully
  - [ ] Connection status shows `connected: true`
  - [ ] Token expiry is future date
  - [ ] `syncMode` is `READ_ONLY`

- [ ] **Phase 4 (Mappings)**
  - [ ] Walk-in customer mapping created
  - [ ] Cash payment method mapping created
  - [ ] Card payment method mapping created
  - [ ] All fuel item mappings created (PMG, HSD, etc.)
  - [ ] Preflight mappings check: PASS

- [ ] **Phase 5 (Rollout)**
  - [ ] Week 1-2: READ_ONLY mode confirmed, no errors in logs
  - [ ] Week 3: DRY_RUN mode enabled, dry-run logs present
  - [ ] Week 4+: FULL_SYNC mode enabled, QB Sales Receipts created
  - [ ] Verify data in QuickBooks UI matches POS records

---

## Support Contacts

**On-call**: [Your contact info]
**Escalation**: [Escalation path]
**QuickBooks Support**: https://help.intuit.com/
**Documentation**: See `docs/quickbooks-go-live-checklist.md` for detailed procedures
