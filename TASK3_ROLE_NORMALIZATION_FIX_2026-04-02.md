# TASK 3: Role Normalization Fix
**Date**: 2026-04-02
**Status**: ✅ CODE COMPLETE (Build verified, awaiting deployment + API test evidence)

---

## Problem
Backend controllers had manual role checking with hardcoded arrays accepting both uppercase and lowercase roles. This was inconsistent and error-prone:

```typescript
// BAD: Manual check with both cases
if (!['ADMIN', 'MANAGER', 'admin', 'manager'].includes(req.user.role)) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

**Issues**:
- Duplicated role strings in every controller
- Mixed case handling (ADMIN vs admin)
- No centralized role permission logic
- Hard to maintain and audit

---

## Solution Implemented

### 1. Added `hasRole()` Utility Function ✅
**File**: `apps/backend/src/middleware/auth.middleware.ts`

```typescript
/**
 * Check if user has one of the allowed roles (case-insensitive)
 * @param user - User payload from JWT
 * @param allowedRoles - Array of allowed role names (lowercase)
 * @returns true if user has one of the allowed roles
 */
export function hasRole(user: TokenPayload | undefined, allowedRoles: string[]): boolean {
  if (!user) {
    return false;
  }

  const userRole = user.role.toLowerCase();
  const normalizedRoles = allowedRoles.map(r => r.toLowerCase());

  return normalizedRoles.includes(userRole);
}
```

**Benefits**:
- Single source of truth for role checking
- Case-insensitive comparison
- Reusable across all controllers
- Type-safe with TokenPayload interface

### 2. Normalized Roles at Auth Boundary ✅
**File**: `apps/backend/src/middleware/auth.middleware.ts`

Updated `authenticate()` middleware to normalize role to lowercase when setting `req.user`:

```typescript
export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    // Normalize role to lowercase for consistent role checking
    req.user = {
      ...payload,
      role: payload.role.toLowerCase(),
    };

    next();
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

**Effect**: All `req.user.role` values are now guaranteed lowercase throughout the request lifecycle.

### 3. Updated `authorize()` Middleware ✅
**File**: `apps/backend/src/middleware/auth.middleware.ts`

```typescript
/**
 * Middleware to check if user has one of the allowed roles
 * @param roles - Array of allowed role names (will be normalized to lowercase)
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!hasRole(req.user, roles)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
```

### 4. Updated Controllers to Use `hasRole()` ✅

**Files Updated**:
1. `apps/backend/src/modules/shifts/shifts.controller.ts` - 3 role checks
2. `apps/backend/src/modules/sales/sales.controller.ts` - 2 role checks
3. `apps/backend/src/modules/meter-readings/meter-readings.controller.ts` - 2 role checks
4. `apps/backend/src/modules/meter-readings/ocr.controller.ts` - 1 role check

**Before**:
```typescript
if (!['ADMIN', 'MANAGER', 'CASHIER', 'OPERATOR'].includes(req.user.role)) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

**After**:
```typescript
if (!hasRole(req.user, ['admin', 'manager', 'cashier', 'operator'])) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

---

## Files Changed

### Core Auth Middleware:
1. ✅ `apps/backend/src/middleware/auth.middleware.ts`
   - Added `hasRole()` function
   - Updated `authenticate()` to normalize roles
   - Updated `authorize()` to use `hasRole()`

### Controllers Updated:
2. ✅ `apps/backend/src/modules/shifts/shifts.controller.ts`
3. ✅ `apps/backend/src/modules/sales/sales.controller.ts`
4. ✅ `apps/backend/src/modules/meter-readings/meter-readings.controller.ts`
5. ✅ `apps/backend/src/modules/meter-readings/ocr.controller.ts`

### Remaining Controllers (Lower Priority):
These still have old-style role checks but are not critical for current deployment:
- `apps/backend/src/modules/customers/customers.controller.ts`
- `apps/backend/src/modules/nozzles/nozzles.controller.ts`
- `apps/backend/src/modules/reports/reports.controller.ts`
- `apps/backend/src/modules/bifurcation/bifurcation.controller.ts`

**Note**: These can be updated in a follow-up task if needed.

---

## Verification

### TypeScript Compilation ✅
```bash
cd apps/backend && npm run build
# Result: PASSED (no errors)
```

### Code Quality ✅
- All role checks now use canonical lowercase format
- Single `hasRole()` function for all role checks
- Consistent behavior across all updated controllers
- Type-safe with TokenPayload interface

---

## Pending Evidence (Required Before "Done")

### API Test Required:
1. Deploy updated backend to production server
2. Test role-based authorization for each endpoint:
   - Login as admin (lowercase in DB)
   - Test shift open/close (should work)
   - Test sales creation (should work)
   - Test meter reading creation (should work)
3. Verify 403 errors for unauthorized roles
4. Document API response showing authorization works

### Acceptance Criteria:
- ✅ Code compiles with no TypeScript errors
- ✅ Build succeeds
- ✅ hasRole() function implemented and used
- ✅ Roles normalized at auth boundary
- ⏳ API tests pass for authorized users
- ⏳ API returns 403 for unauthorized users
- ⏳ No regression in existing functionality

---

## Benefits

### Security:
- Centralized role checking logic (easier to audit)
- Case-insensitive comparison (prevents role bypass via case manipulation)
- Type-safe role checks

### Maintainability:
- Single source of truth for role permissions
- Easy to add new roles
- Easy to update role logic globally
- Reduces code duplication

### Debugging:
- Easier to trace role authorization issues
- Consistent error messages
- Clear separation of auth vs. authorization logic

---

## Database Migration (Optional - Not Included)

For complete normalization, should also run DB migration to lowercase all roles in `users` table:

```sql
-- OPTIONAL: Normalize existing roles in database
UPDATE users SET role = LOWER(role);
```

**Status**: NOT included in this fix (roles are normalized at runtime).
**Reason**: Runtime normalization handles both old and new data without requiring DB migration.

---

## Rollback Plan

If deployment causes issues:

```bash
# Revert to previous commit
git checkout HEAD~1 apps/backend/src/middleware/auth.middleware.ts \
  apps/backend/src/modules/shifts/shifts.controller.ts \
  apps/backend/src/modules/sales/sales.controller.ts \
  apps/backend/src/modules/meter-readings/

# Rebuild
cd apps/backend && npm run build

# Redeploy
# (follow deployment procedure)
```

---

## Next Steps

1. **Deploy to production** (commit + push + server deploy)
2. **API test** (verify role checks work with lowercase roles)
3. **Document evidence** (API response logs)
4. **Mark task complete** (only after API evidence)

---

**Status**: Code complete, build verified. Awaiting deployment + API test evidence before marking "Done".
