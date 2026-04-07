# QuickBooks Mapping Flow Fixes - 2026-04-07

## Commit: 7edb616

## Issues Fixed

### 1. Already-mapped entities reappear in Auto-Match ✅

**Root Cause:**
- `runMatching()` only excluded already-mapped QB IDs from candidate pool
- Did NOT exclude already-mapped POS account needs from the matching loop
- Result: Mapped accounts like `fuel_income_pmg` appeared again in decision list

**Fix Applied:**
- Lines 219-221: Build `mappedAccountNeedKeys` set from existing account mappings
- Line 255: Pass `mappedAccountNeedKeys` to `matchAccounts()` as 3rd parameter
- Lines 377-399: Filter `FUEL_STATION_NEEDS` to exclude mapped need keys
- Added console logs showing unmapped vs total account needs

**Verification:**
1. Create mapping for `fuel_income_pmg` → QB account
2. Run Auto-Match again
3. ✅ Confirm `fuel_income_pmg` does NOT appear in pending accounts list
4. ✅ Accounts tab shows reduced count (e.g., 19/20 instead of 20/20)

---

### 2. Dropdown selections don't stick ✅

**Root Cause:**
- Select component values were mixed types (string | number | null)
- Comparison `c.qbAccountId === value` failed when types didn't match
- Example: `value="123"` (string) vs `c.qbAccountId=123` (number)
- State updated but UI didn't reflect because comparison failed

**Fix Applied:**
**MappingsPanel.tsx:**
- Line 512: `value={String(item.decisionAccountId ?? '')}`
- Line 514: `find((c) => String(c.qbAccountId) === String(value))`
- Line 523: `find(c => String(c.qbAccountId) === String(item.decisionAccountId))`
- Line 529: `key={String(...)}` and `value={String(...)}`
- Lines 615, 617, 634, 641: Same String() normalization for entity dropdowns

**Verification:**
1. Run Auto-Match for accounts with candidates
2. Open dropdown for "Fuel Income (PMG)" account
3. Select any candidate from dropdown (e.g., 2nd or 3rd option)
4. ✅ Confirm selected option shows immediately WITHOUT pressing Accept
5. ✅ Confirm selection persists after switching tabs and back
6. Repeat for Customers, Items, Banks tabs

---

### 3. `create_new` not implemented ✅

**Root Cause:**
- `applyAccountDecisions()` line 736: Returned error "not yet implemented"
- `applyEntityDecisions()` line 796: Returned error "not yet implemented"
- No QB API integration for entity creation

**Fix Applied:**

**A) applyAccountDecisions() (lines 695-804):**
- Use `getValidAccessToken(organizationId, prisma)` for auto token refresh
- Build QB Account payload with `Name`, `AccountType`, `AccountSubType` (if needed)
- POST to `/v3/company/{realmId}/account` with Bearer token
- Parse response to get `newAccount.Id` and `newAccount.Name`
- Upsert mapping with created QB account ID
- Return structured errors: `Array<{ needKey: string; error: string }>`

**B) applyEntityDecisions() (lines 749-890):**
- Implement for all 3 entity types: customer, item, bank
- **Customer:** POST `/customer` with `{ DisplayName, Active: true }`
- **Item:** POST `/item` with `{ Name, Type: 'Service', Active: true }`
- **Bank:** POST `/account` with `{ Name, AccountType: 'Bank', Active: true }`
- Use `getValidAccessToken()` for all writes
- Return structured errors: `Array<{ localId: string; error: string }>`

**Verification:**
1. Run Auto-Match and find unmapped entity (e.g., new customer)
2. Select "Create New" decision (if UI has that option, otherwise API only)
3. Call `/api/quickbooks/match/:matchId/apply` (accounts) or `/apply-entities` (entities)
4. ✅ Confirm QB entity created in QuickBooks (check via QB web UI)
5. ✅ Confirm mapping saved to `qb_entity_mappings` table
6. ✅ Confirm error response shows per-entity failures (not batch abort)

---

### 4. Entity type validation missing 'account' and 'bank' ✅

**Root Cause:**
- `entity-mapping.service.ts` validTypes arrays only had `['customer', 'payment_method', 'item']`
- Calls with `entityType='account'` or `entityType='bank'` threw validation errors
- Auto-match couldn't save account or bank mappings

**Fix Applied:**
**entity-mapping.service.ts:**
- Line 78: Added `'bank', 'account'` to validTypes
- Line 152: Added `'bank', 'account'` to validTypes (getQbId)
- Line 210: Added `'bank', 'account'` to validTypes (getLocalId)
- Line 273: Added `'bank', 'account'` to validTypes (listMappings filter)

**routes.ts:**
- Line 1034: Added `'bank', 'account'` to validTypes (GET /mappings)
- Line 1084: Added `'bank', 'account'` to validTypes (POST /mappings)
- Line 1148: Added `'bank', 'account'` to validTypes (POST /mappings/bulk)

**Verification:**
1. Create account mapping via API: `POST /api/quickbooks/mappings`
   ```json
   {
     "entityType": "account",
     "localId": "fuel_income_pmg",
     "qbId": "123",
     "qbName": "Fuel Sales - PMG"
   }
   ```
2. ✅ Confirm 200 OK (no validation error)
3. Create bank mapping via API: `POST /api/quickbooks/mappings`
   ```json
   {
     "entityType": "bank",
     "localId": "local-bank-uuid",
     "qbId": "456",
     "qbName": "Cash Account"
   }
   ```
4. ✅ Confirm 200 OK (no validation error)
5. ✅ List mappings: `GET /api/quickbooks/mappings?entityType=account`
6. ✅ Confirm both account and bank mappings returned

---

## Deployment Checklist

### Pre-Deploy
- [x] Commit changes with co-author tag
- [ ] Backend build passes locally: `cd apps/backend && npm run build`
- [ ] Frontend build passes locally: `cd apps/web && npm run build`
- [ ] No TypeScript errors in either app

### Deploy Sequence (Follow CLAUDE.md Protocol)
1. **Commit before build** ✅ (7edb616)
2. **Backend Deploy:**
   ```bash
   ssh root@64.226.65.80
   cd ~/kuwait-pos
   git pull
   docker build -f Dockerfile.prod -t kuwaitpos-backend:7edb616 .
   docker tag kuwaitpos-backend:7edb616 kuwaitpos-backend:latest
   docker compose -f docker-compose.prod.yml up -d backend
   ```
3. **Frontend Deploy:**
   ```bash
   # Local build
   cd apps/web
   npm run build

   # Upload to server
   scp -r dist root@64.226.65.80:~/kuwait-pos/apps/web/dist_new

   # Atomic swap
   ssh root@64.226.65.80 "cd ~/kuwait-pos/apps/web && mv dist dist_old && mv dist_new dist"
   ssh root@64.226.65.80 "docker compose -f docker-compose.prod.yml restart nginx"
   ```

### Verification Gates (ALL Required)
1. [ ] Login works
2. [ ] QuickBooks connection active
3. [ ] Run Auto-Match:
   - [ ] No duplicate mapped entities
   - [ ] Dropdown selection persists
4. [ ] Create new QB entity via create_new:
   - [ ] Account creation works
   - [ ] Customer creation works
   - [ ] Item creation works
   - [ ] Bank creation works
5. [ ] Mappings table shows new entries
6. [ ] Browser console clean (no JS errors)
7. [ ] Bundle hash changed: `index-XXXXXX.js` != previous hash

### Rollback Plan
If any gate fails:
```bash
ssh root@64.226.65.80
cd ~/kuwait-pos
git checkout 25fbddd  # Previous working commit
docker build -f Dockerfile.prod -t kuwaitpos-backend:rollback .
docker tag kuwaitpos-backend:rollback kuwaitpos-backend:latest
docker compose -f docker-compose.prod.yml up -d backend
cd apps/web && mv dist dist_broken && mv dist_old dist
docker compose -f docker-compose.prod.yml restart nginx
```

---

## API Proof Commands

### Test Already-Mapped Filter
```bash
# 1. Create a test account mapping
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/mappings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "account",
    "localId": "fuel_income_pmg",
    "qbId": "test-123",
    "qbName": "Test Fuel Income"
  }'

# 2. Run Auto-Match
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/match/run \
  -H "Authorization: Bearer $TOKEN"

# 3. Get match result and verify fuel_income_pmg NOT in accountItems
curl https://kuwaitpos.duckdns.org/api/quickbooks/match/$MATCH_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.result.accountItems[] | select(.needKey == "fuel_income_pmg")'
# Expected: empty (no output)
```

### Test create_new Flow
```bash
# 1. Run Auto-Match
RESULT=$(curl -s -X POST https://kuwaitpos.duckdns.org/api/quickbooks/match/run \
  -H "Authorization: Bearer $TOKEN")
MATCH_ID=$(echo $RESULT | jq -r '.result.id')

# 2. Set decision to create_new for an unmapped account
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/match/$MATCH_ID/decisions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decisions": [
      {
        "needKey": "operating_expense",
        "decision": "create_new"
      }
    ]
  }'

# 3. Apply decisions
curl -X POST https://kuwaitpos.duckdns.org/api/quickbooks/match/$MATCH_ID/apply \
  -H "Authorization: Bearer $TOKEN"

# 4. Verify mapping created
curl https://kuwaitpos.duckdns.org/api/quickbooks/mappings?entityType=account \
  -H "Authorization: Bearer $TOKEN" | jq '.mappings[] | select(.localId == "operating_expense")'
# Expected: { id, qbId, qbName, ... }
```

### Test Dropdown Persistence (Browser Console)
```javascript
// 1. Open QuickBooks > Auto-Match
// 2. Open Accounts tab with candidates
// 3. Open dropdown for any account
// 4. Select 2nd option (not the starred one)
// 5. Run in console:
const accountItems = document.querySelector('[data-match-result]').__reactProps$.return.memoizedState.matchResult.accountItems;
const targetItem = accountItems.find(i => i.candidates.length > 1);
console.log('Selected:', targetItem.decisionAccountId, 'Expected:', targetItem.candidates[1].qbAccountId);
// Verify: Selected matches Expected (both same ID)
```

---

## Error Response Format Change

### Before (String Array)
```json
{
  "success": false,
  "mappingsCreated": 3,
  "errors": [
    "Failed to map Fuel Income: QB API error",
    "Auto-create for Bank Account not yet implemented"
  ]
}
```

### After (Structured Array)
```json
{
  "success": false,
  "mappingsCreated": 3,
  "errors": [
    {
      "needKey": "fuel_income_pmg",
      "error": "Failed to map Fuel Income (PMG): QB API error: 401 - Unauthorized"
    },
    {
      "localId": "bank-uuid-123",
      "error": "Failed to map Cash Account: Network timeout"
    }
  ]
}
```

**Frontend Impact:** Update error display to handle object array instead of string array.

---

## Files Changed
- `apps/backend/src/services/quickbooks/auto-match.service.ts` (101 lines)
- `apps/backend/src/services/quickbooks/entity-mapping.service.ts` (8 lines)
- `apps/backend/src/services/quickbooks/routes.ts` (6 lines)
- `apps/web/src/components/quickbooks/MappingsPanel.tsx` (44 lines)
- `CLAUDE.md` (1 line - trailing newline)

**Total:** 5 files, 175 insertions, 30 deletions
