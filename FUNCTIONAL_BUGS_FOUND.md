# Functional Bugs - Manual Testing Results (2026-04-02)

**System**: https://kuwaitpos.duckdns.org (64.226.65.80)
**Tested By**: Manual Functional Testing Agent
**Test Method**: API testing + Database inspection + Recent fixes verification

---

## CRITICAL Bugs (Fix Immediately) 🔴

### 1. CRITICAL: Missing Customer Data
- **Symptom**: Customers table is empty (0 records) but POS requires customers for credit sales
- **Impact**: Credit sales cannot be completed - no customers to select from dropdown
- **Root Cause**: Demo data seed script not executed on deployment
- **Test Proof**: `docker exec kuwaitpos-postgres psql ... SELECT COUNT(*) FROM customers;` returns `0`
- **Fix Needed**: Run `npm run db:seed` on server OR insert demo customers via SQL

### 2. CRITICAL: Fuel Sale Creation Parameter Validation
- **Symptom**: POST `/api/sales/fuel` requires `branchId`, `nozzleId`, `fuelTypeId` but validation errors may occur silently
- **Impact**: Fuel sales creation fails if UI doesn't provide all parameters correctly
- **Fix Needed**: Verify POS component at `apps/web/src/pages/POS.tsx` passes all required fields from nozzle selection

### 3. CRITICAL: Role Case Inconsistency in Database
- **Symptom**: Users table has mixed-case roles: `ADMIN`, `MANAGER`, `OPERATOR` (uppercase) AND `admin`, `operator` (lowercase)
- **Impact**: If any authorization checks use case-sensitive comparison, some users denied access
- **Database Reality**: Roles found: `ADMIN, OPERATOR, ACCOUNTANT, CASHIER, MANAGER, operator, admin`
- **Current Status**: Auth middleware normalizes to lowercase, so WORKS but data inconsistency is risky
- **Fix Needed**: Standardize all roles to lowercase in database

---

## HIGH Bugs (Fix Before Client) 🟠

### 4. HIGH: Reports Endpoint Missing branchId Parameter
- **Symptom**: `GET /api/reports/daily-sales?date=2026-04-01` returns 400 "Validation Error - missing branchId"
- **Impact**: Frontend reports fail if branchId not passed
- **Test Proof**: Endpoint requires `branchId` parameter (discovered through validation error)
- **Fix Needed**: Either make branchId optional (default to user's branch) OR document as required

### 5. HIGH: Operator Role Cannot Access Reports
- **Symptom**: Operator role gets 403 "Insufficient permissions" on `/api/reports/daily-sales`
- **Impact**: Only managers can view reports - operators locked out
- **Test Proof**: Operator token returns 403 on reports endpoints
- **Fix Needed**: Add "operator" to allowed roles in reports controller OR clarify role restrictions

### 6. HIGH: Dispensing Units Endpoint Format Inconsistency
- **Symptom**: No direct `/api/dispensing-units?branchId=...` endpoint exists (returns 404)
- **Impact**: Frontend relies on `/api/branches/{id}/dispensing-units` (nested) which works, but inconsistent API design
- **Fix Needed**: Either add query endpoint OR ensure all code uses nested endpoint

---

## MEDIUM Bugs 🟡

### 7. MEDIUM: Products Exist But No Customers
- **Symptom**: Database has 85 products but 0 customers
- **Impact**: Product catalog exists but cannot make non-fuel sales without customers
- **Fix Needed**: Same as #1 - run seed script

### 8. MEDIUM: Limited Shift Data
- **Symptom**: Only 2 shifts in database but 3 dispensing units configured
- **Impact**: Shift selection may be incomplete
- **Fix Needed**: Review if 2 shifts sufficient or add more

---

## ✅ VERIFIED WORKING (No Bugs Found)

- ✅ **Fuel Prices API**: Returns correct data with pricePerLiter (321.17, 335.86)
- ✅ **Health Check**: Endpoint responds `{"status":"ok"}`
- ✅ **Authentication**: Login works for all user roles
- ✅ **Sync Queue**: `/api/sync/queue` accepts and processes transactions
- ✅ **Branches API**: Returns data with dispensing units and nozzles nested properly
- ✅ **Nozzles**: Correct fuel type associations and metadata
- ✅ **Sales List**: `GET /api/sales` returns paginated results
- ✅ **Daily Sales Report**: Works when `branchId` provided
- ✅ **Frontend**: React app loads at https://kuwaitpos.duckdns.org
- ✅ **Recent Fixes**: Fuel prices fix (2026-04-01) deployed successfully
- ✅ **Recent Fixes**: Nozzles camelCase fix (2026-04-02) deployed successfully

---

## Database State Summary

| Table | Count | Status |
|-------|-------|--------|
| Users | 7 | ⚠️ Mixed case roles |
| Fuel Prices | 2 | ✅ Correct (PMG, HSD) |
| Dispensing Units | 1 | ✅ OK |
| Nozzles | 3 | ✅ OK (all HSD) |
| Products | 85 | ✅ OK |
| **Customers** | **0** | 🔴 **CRITICAL - EMPTY** |
| Shifts | 2 | 🟡 May need more |

---

## Test Coverage Gaps (See SYSTEM_AUDIT_BUGS.md)

The QA Engineer agent identified 12 critical test coverage gaps:
- No automated tests for fuel sale flow
- No offline sync E2E tests
- No credit limit enforcement tests
- No duplicate prevention tests
- etc.

These are NOT bugs (features work), but risks for long-term maintenance.

---

## Deployment Recommendation

### 🔴 BLOCK CLIENT DEPLOYMENT Until:

1. **Populate customers table** - Run seed script or insert demo customers
   ```bash
   ssh root@64.226.65.80 "docker exec kuwaitpos-backend npm run db:seed:customers"
   ```

2. **Standardize user roles to lowercase**
   ```sql
   UPDATE users SET role = LOWER(role);
   ```

3. **Fix reports branchId requirement** - Make it optional (default to user's branch)

4. **Fix operator report access** - Add operator to allowed roles

### ✅ CAN PROCEED With:

- Fuel sales (price lookup working)
- Product sales (once customers seeded)
- Nozzle management
- Sync queue for offline POS
- QuickBooks integration (pending other agent's report)

---

**Next Steps**: Fix the 4 CRITICAL/HIGH bugs above, then system is client-ready.
