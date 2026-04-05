# Continuation Prompt: QuickBooks Auto-Mapping Implementation

**Date:** 2026-04-05 18:40 UTC
**Branch:** `master` (commit: e9683ac)
**Session Focus:** Replace manual QB mapping with automated wizard (copying restaurant POS patterns)

---

## ✅ COMPLETED THIS SESSION

### 1. QuickBooks OAuth & Basic Mapping ✅
- ✅ Fixed FRONTEND_URL redirect issue (was going to localhost, now production)
- ✅ Connected to QuickBooks Online: "Petrol Pump" company
- ✅ All 7 preflight checks passed
- ✅ Created basic entity mappings:
  - Walk-in customer → QB Customer #71
  - PMG (Premium Gasoline) → QB Item #200011503
  - HSD (High Speed Diesel) → QB Item #200011302
  - Payment methods: cash, card

### 2. Database Schema Updates ✅
- ✅ Created `QBEntitySnapshot` model in Prisma schema
- ✅ Created migration: `20260405_qb_entities_snapshot/migration.sql`
- ✅ Added `fetch-entities.service.ts` for querying QB API
- ⚠️ **NOT YET DEPLOYED** - need to run migration on server

### 3. Files Created (Not Committed Yet)
```
apps/backend/scripts/fetch-qb-entities.ts
apps/backend/src/services/quickbooks/fetch-entities.service.ts
packages/database/prisma/migrations/20260405_qb_entities_snapshot/migration.sql
packages/database/prisma/schema.prisma (updated)
apps/web/dist.tar.gz (build artifact - should be in .gitignore)
```

---

## 🎯 CURRENT TASK: Implement Auto-Mapping Wizard

### Reference: Restaurant POS Project
**Path:** `C:\Users\Malik\Desktop\POS-Project`

**Files to copy patterns from:**
1. **Needs Catalog:** `backend/app/services/quickbooks/pos_needs.py`
   - Defines what accounting concepts the POS requires
   - Each need has: key, label, description, expected QB types, search hints

2. **Auto-Match Logic:** `backend/app/services/quickbooks/diagnostic.py`
   - Fuzzy matching algorithm
   - Confidence scoring (high/medium/low)
   - Match result structure

3. **API Endpoints:** `backend/app/api/v1/quickbooks.py`
   - POST /match/run - fetch QB + compute suggestions
   - GET /match/:id - get match status
   - POST /match/:id/decisions - user review
   - POST /match/:id/apply - create QB entities + save mappings

4. **UI Wizard:** `frontend/src/pages/admin/qb/AccountSetupTab.tsx`
   - "Run Matching" → Review → Apply flow
   - No manual ID entry

5. **Auto-Creation:** `backend/app/services/quickbooks/sync.py`
   - Auto-create missing QB entities during sync
   - Find-or-create pattern

---

## 📋 IMPLEMENTATION CHECKLIST

### Phase 1: Kuwait Fuel Station Needs Catalog
Create `apps/backend/src/services/quickbooks/kuwait-needs.ts`:

**Required Mappings:**
```typescript
const KUWAIT_FUEL_NEEDS = [
  // INCOME
  { key: 'fuel_income_pmg', label: 'PMG Fuel Sales', required: true,
    expectedTypes: ['Income'], hints: ['premium', 'gasoline', 'petrol', 'pmg'] },
  { key: 'fuel_income_hsd', label: 'HSD Fuel Sales', required: true,
    expectedTypes: ['Income'], hints: ['diesel', 'hsd', 'high speed'] },
  { key: 'nonfuel_income', label: 'Non-Fuel Product Sales', required: false,
    expectedTypes: ['Income'], hints: ['retail', 'shop', 'products'] },

  // ASSETS
  { key: 'cash', label: 'Cash Account', required: true,
    expectedTypes: ['Bank'], hints: ['cash', 'petty cash', 'cash on hand'] },
  { key: 'bank_card_settlement', label: 'Bank Card Settlement', required: true,
    expectedTypes: ['Bank'], hints: ['card', 'credit card', 'debit'] },
  { key: 'pso_card_settlement', label: 'PSO Card Settlement', required: false,
    expectedTypes: ['Bank'], hints: ['pso', 'fleet card'] },
  { key: 'credit_customer_receivable', label: 'Credit Customer Receivables', required: true,
    expectedTypes: ['Accounts Receivable'], hints: ['receivable', 'credit', 'ar'] },
  { key: 'inventory_asset', label: 'Fuel Inventory Asset', required: true,
    expectedTypes: ['Other Current Assets'], hints: ['inventory', 'fuel stock'] },

  // EXPENSES
  { key: 'cogs_fuel', label: 'Fuel COGS', required: true,
    expectedTypes: ['Cost of Goods Sold'], hints: ['cogs', 'fuel cost', 'cost of sales'] },
  { key: 'purchases_expense', label: 'Purchases/Inventory', required: false,
    expectedTypes: ['Expense'], hints: ['purchases', 'buying'] },
  { key: 'ap_vendor_control', label: 'Accounts Payable', required: false,
    expectedTypes: ['Accounts Payable'], hints: ['payable', 'vendor', 'ap'] },
];
```

### Phase 2: Matching Service
Create `apps/backend/src/services/quickbooks/auto-match.service.ts`:

**Key functions:**
```typescript
class AutoMatchService {
  // Fetch QB accounts/items/customers and match to local needs
  async runMatching(organizationId: string): Promise<MatchResult>

  // Fuzzy match with scoring
  private fuzzyMatch(need: Need, qbEntities: QBEntity[]): Candidate[]

  // Store match result in memory/cache
  async saveMatchResult(matchId: string, result: MatchResult): Promise<void>
}
```

**Match confidence:**
- High (90%+): Auto-accept
- Medium (70-89%): Show for review
- Low (<70%): Unmatched

### Phase 3: New API Endpoints
Add to `apps/backend/src/services/quickbooks/routes.ts`:

```typescript
// POST /api/quickbooks/match/run
router.post('/match/run', authenticate, authorize('admin'), async (req, res) => {
  // 1. Fetch QB Chart of Accounts, Items, Customers
  // 2. Run fuzzy matching against Kuwait needs
  // 3. Return match result with matchId
});

// GET /api/quickbooks/match/:matchId
router.get('/match/:matchId', authenticate, async (req, res) => {
  // Return stored match result
});

// POST /api/quickbooks/match/:matchId/decisions
router.post('/match/:matchId/decisions', authenticate, authorize('admin'), async (req, res) => {
  // User approves/rejects/customizes matches
  // Updates match result in cache
});

// POST /api/quickbooks/match/:matchId/apply
router.post('/match/:matchId/apply', authenticate, authorize('admin'), async (req, res) => {
  // 1. For "create_new" decisions: create QB account/item
  // 2. Create all entity mappings in qb_entity_mappings table
  // 3. Audit log all actions
  // 4. Return success + created QB IDs
});
```

### Phase 4: Update UI - Replace Manual Mapping
Update `apps/web/src/components/quickbooks/MappingsPanel.tsx`:

**Remove:**
- Manual ID input forms
- Bulk CSV import

**Add:**
```tsx
<Wizard>
  <Step1: RunMatching>
    - Button: "Run Auto-Matching"
    - Shows loading spinner
    - Calls POST /match/run

  <Step2: ReviewMatches>
    - Shows needs grouped by confidence
    - High confidence (auto-accept): green checkmarks
    - Medium confidence: yellow, user picks from candidates
    - Low/unmatched: red, option to "Create New in QB"
    - User can override any decision

  <Step3: Apply>
    - Button: "Apply Mappings"
    - Shows progress (creating QB entities, saving mappings)
    - Calls POST /match/:id/apply

  <Step4: Complete>
    - Shows success summary
    - Link to run preflight checks again
</Wizard>
```

### Phase 5: Auto-Create During Sync
Update fuel sale handler `apps/backend/src/services/quickbooks/handlers/fuel-sale.handler.ts`:

**Before creating SalesReceipt:**
```typescript
// Find or create customer mapping
const customerMapping = await EntityMappingService.findMapping(
  organizationId, 'customer', customerId
);

if (!customerMapping) {
  // Auto-create customer in QB
  const qbCustomer = await createQBCustomer(customerName);
  // Save mapping
  await EntityMappingService.upsertMapping(
    organizationId, 'customer', customerId, qbCustomer.Id, qbCustomer.DisplayName
  );
}

// Same for items, payment methods
```

### Phase 6: Audit Trail
Add to `apps/backend/src/services/quickbooks/audit-logger.ts`:

**Log operations:**
- MATCH_RUN (with snapshot of QB entities fetched)
- MATCH_DECISION_SAVED (user choices)
- MATCH_APPLY_START
- QB_ENTITY_CREATED (account/item/customer created in QB)
- MAPPING_CREATED (local mapping saved)
- MATCH_APPLY_COMPLETE

---

## 🧪 TESTING REQUIREMENTS

**Before claiming done:**

1. **Unit Tests:**
   - Fuzzy matching score calculation
   - Decision apply logic
   - Find-or-create paths

2. **Integration Test:**
   ```
   1. OAuth connected to QB ✓
   2. Run match → verify suggestions correct
   3. Apply decisions → verify QB entities created
   4. Finalize backdated day → verify sync uses mappings
   5. Verify multi-payment-type sale syncs correctly
   ```

3. **Proof Required:**
   - Sample request/response for match/apply
   - DB rows in qb_entity_mappings
   - QB object IDs created/reused
   - Queue job success logs

---

## ⚠️ CONSTRAINTS

1. **QuickBooks Online ONLY** - no QB Desktop
2. **No manual ID entry** - unless automation fails and explicit fallback
3. **Keep safety gates** - WRITE_MODE, approval controls, kill switch
4. **Sales-driven priority** - map products with actual sales first (YARIS FILTER, WAGON AIR FILTER)
5. **Immutable audit** - log all mapping decisions and QB entity creations

---

## 🚨 CRITICAL REMINDERS

1. **Git hygiene:**
   ```bash
   # Remove build artifact from staging
   git reset apps/web/dist.tar.gz

   # Add to .gitignore
   echo "apps/web/dist.tar.gz" >> .gitignore
   ```

2. **Deploy migration before using:**
   ```bash
   ssh root@64.226.65.80 "cd /root/kuwait-pos && \
     docker exec kuwaitpos-backend npx prisma migrate deploy"
   ```

3. **Commit co-author:**
   ```
   Co-Authored-By: Malik Amin <amin@sitaratech.info>
   ```

---

## 📊 CURRENT STATE

**QuickBooks Connection:** ✅ Connected to "Petrol Pump"
**Sync Mode:** READ_ONLY (client hasn't approved FULL_SYNC yet)
**Basic Mappings:** ✅ Walk-in, PMG, HSD, payment methods
**Additional Mappings Needed:** Non-fuel products (2), expense accounts, bank accounts

**Next Immediate Action:** Implement auto-mapping wizard to replace manual mapping workflow.

---

## 🔗 RESUME COMMAND

```
Read C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump\CONTINUATION_PROMPT_2026-04-05_QB_AUTOMAPPING.md and implement the QuickBooks auto-mapping wizard as specified.
```
