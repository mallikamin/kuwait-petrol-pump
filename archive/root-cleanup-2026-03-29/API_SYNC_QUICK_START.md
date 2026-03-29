# Quick Start: View Acceptance Test Evidence

## TL;DR - All Tests Passed ✅

**Date**: 2026-03-28
**Status**: ✅ **5 sales synced, 0 failures, 100% security enforcement**

---

## View Evidence (30 seconds)

### 1. Evidence Files
```bash
cd acceptance-evidence-20260328-185953/
ls -lah  # 14 files (JSON requests/responses + DB queries)
```

### 2. Key Files to Review
```bash
# Web client test
cat web-sync-response.json      # {"synced":2,"failed":0}
cat web-db-sale-1.txt            # Sale confirmed in PostgreSQL

# Desktop client test
cat desktop-sync-response.json   # {"synced":2,"failed":0}
cat desktop-db-sale-1.txt        # Sale confirmed in PostgreSQL

# Overall summary
cat final-db-summary.txt         # All 5 acceptance test sales in DB
```

---

## Run Tests Yourself (2 minutes)

### Automated Test Script
```bash
cd /path/to/kuwait-petrol-pump
bash scripts/acceptance-tests.sh
```

**What It Tests**:
1. ✅ Web client: 2 offline sales → sync → DB verification
2. ✅ Desktop client: 2 offline sales → sync → DB verification
3. ✅ Duplicate protection: Replay same sync → synced=0
4. ✅ JWT security: Spoof cashier_id → backend overwrites it

**Output**:
- Green ✅ messages = test passed
- Evidence directory: `acceptance-evidence-YYYYMMDD-HHMMSS/`
- Exit code: 0 = all passed, 1 = failure

---

## View DB Records (Live)

### SSH to Production Droplet
```bash
ssh root@64.226.65.80

# Query acceptance test sales
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c \
  "SELECT offline_queue_id, sale_type, total_amount, payment_method,
   SUBSTRING(cashier_id::text, 1, 12) || '...' as cashier,
   sync_status, created_at
   FROM sales
   WHERE offline_queue_id LIKE 'accept-%'
   ORDER BY created_at DESC;"
```

**Expected Output**:
```
 offline_queue_id           | sale_type | total_amount | payment_method | cashier         | sync_status | created_at
----------------------------+-----------+--------------+----------------+-----------------+-------------+-------------------
 accept-desktop-83425dc4... | non_fuel  |        30.00 | card           | 9a9f2d10-e90... | synced      | 2026-03-28 14:00
 accept-desktop-6c47a99f... | fuel      |        75.00 | cash           | 9a9f2d10-e90... | synced      | 2026-03-28 14:00
 accept-web-spoofed-9af1... | fuel      |        99.99 | cash           | 9a9f2d10-e90... | synced      | 2026-03-28 14:00
 accept-web-e1ff5db4...     | non_fuel  |        25.50 | card           | 9a9f2d10-e90... | synced      | 2026-03-28 13:59
 accept-web-1ebb0109...     | fuel      |        50.00 | cash           | 9a9f2d10-e90... | synced      | 2026-03-28 13:59
```

---

## Full Documentation

### 1. Comprehensive Evidence Report
📄 **[ACCEPTANCE_TEST_EVIDENCE.md](./ACCEPTANCE_TEST_EVIDENCE.md)**
- Test scenarios, execution, results
- Evidence file descriptions
- Security test details
- Performance metrics

### 2. Sprint 1 Completion Summary
📄 **[SPRINT_1_COMPLETE_WITH_EVIDENCE.md](./SPRINT_1_COMPLETE_WITH_EVIDENCE.md)**
- What was completed
- Key deliverables
- Acceptance criteria (all met)
- Next steps (Sprint 2)

### 3. Requirements Traceability
📄 **[docs/REQUIREMENTS_TRACE_MATRIX.md](./docs/REQUIREMENTS_TRACE_MATRIX.md)**
- Section 1.1: Mobile OCR Meter Reading Queue (updated)
- Section 1.2: POS Transaction Queue (updated)
- Evidence references for each requirement

---

## Test Cleanup (Optional)

### Remove Test Data from Production DB
```bash
ssh root@64.226.65.80

# Delete acceptance test sales (safe - only deletes 'accept-*' IDs)
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c \
  "DELETE FROM sales WHERE offline_queue_id LIKE 'accept-%';"

# Verify deletion
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c \
  "SELECT COUNT(*) FROM sales WHERE offline_queue_id LIKE 'accept-%';"
# Should return: 0
```

**Note**: Only run this after archiving evidence directory!

---

## Quick Reference

### API Endpoint Tested
```
POST http://64.226.65.80/api/sync/queue
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "deviceId": "WEB-BROWSER-abc123",
  "sales": [
    {
      "offlineQueueId": "accept-web-...",
      "branchId": "9bcb8674-9d93-4d93-b0fc-270305dcbe50",
      "saleType": "fuel",
      "totalAmount": 50.00,
      "paymentMethod": "cash",
      "status": "completed",
      "saleDate": "2026-03-28T13:59:54Z"
    }
  ]
}
```

### Response Format
```json
{
  "success": true,
  "synced": 2,
  "failed": 0,
  "duplicates": 0,
  "details": {
    "sales": {
      "success": true,
      "synced": 2,
      "failed": 0,
      "duplicates": 0,
      "errors": []
    }
  }
}
```

---

## Next Steps

### Sprint 2 (Pending)
1. Mobile OCR end-to-end testing
2. Bifurcation workflow UI
3. Credit customer CRUD screens
4. Large batch sync stress test (1000+ sales)

### Production (Pending User Action)
1. Provide QuickBooks production credentials (Client ID + Secret)
2. Configure QuickBooks OAuth callback
3. Test QuickBooks sync (sales → invoices)

---

**Questions?** See full documentation:
- [ACCEPTANCE_TEST_EVIDENCE.md](./ACCEPTANCE_TEST_EVIDENCE.md) - Test details
- [SPRINT_1_COMPLETE_WITH_EVIDENCE.md](./SPRINT_1_COMPLETE_WITH_EVIDENCE.md) - Completion summary
- [scripts/acceptance-tests.sh](./scripts/acceptance-tests.sh) - Automated test script
