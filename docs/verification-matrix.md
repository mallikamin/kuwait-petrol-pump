# Verification Matrix — Phase 2-5 Hardening Sprint

Running audit trail of pre- and post-change validation for each task
in the Phase 2-5 follow-up sprint (QB bootstrap → unified ledger →
tests → reports page). One section per task; each section records
seed data, exact commands executed, expected vs actual results, and
pass/fail.

| Task | Branch                                 | Status     | PR   |
| ---- | -------------------------------------- | ---------- | ---- |
| 1    | `feature/qb-bootstrap-mappings`        | in-progress | —    |
| 2    | `feature/unified-customer-ledger`      | pending    | —    |
| 3    | `feature/phase25-unit-tests`           | pending    | —    |
| 4    | `feature/reports-page-additions`       | pending    | —    |

---

## Baseline (before Task 1)

Captured on branch `master @ 46eae21` (tag `mvp-v9-cash-recon-expenses`).

| Check                             | Command                                                                                | Result         |
| --------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| Git tree clean (core)             | `git status --porcelain` — only untracked docs/scripts (unchanged from prior sprint)   | OK             |
| Backend typecheck                 | `cd apps/backend && npx tsc --noEmit`                                                  | PASS (exit 0)  |
| Web typecheck                     | `cd apps/web && npx tsc --noEmit`                                                      | PASS (exit 0)  |
| Existing jest (cash-ledger)       | `cd apps/backend && npx jest --testPathPattern='cash-ledger'`                          | 10/10 passing  |

---

## Task 1 — QB mapping bootstrap

### Scope

Seed `qb_entity_mappings` rows required by the Phase 2-5 modules and
verify 17 expense-account QB names exist. Strict scope: no business
logic changes, no migrations, no new endpoints.

### Files added

- `scripts/qb_bootstrap_mappings.js` — bootstrap script (runs inside backend container)
- `docs/qb-mapping-bootstrap.md` — runbook + mapping table + exit codes

### Pre-change checks

| Check                      | Command                                       | Expected       | Actual         |
| -------------------------- | --------------------------------------------- | -------------- | -------------- |
| Backend typecheck          | `cd apps/backend && npx tsc --noEmit`         | PASS           | PASS (baseline) |
| Web typecheck              | `cd apps/web && npx tsc --noEmit`             | PASS           | PASS (baseline) |
| cash-ledger jest           | `npx jest --testPathPattern='cash-ledger'`    | 10/10          | 10/10           |

### Post-change checks

| Check                     | Command                                                                                   | Expected                                      | Actual |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| Backend typecheck         | `cd apps/backend && npx tsc --noEmit`                                                     | PASS (no regression — script is plain JS)     | PASS (exit 0) |
| Web typecheck             | `cd apps/web && npx tsc --noEmit`                                                         | PASS (script is backend-only)                 | PASS (exit 0, baseline) |
| cash-ledger jest          | `npx jest --testPathPattern='cash-ledger'`                                                | 10/10 passing (no regression)                 | 10/10 passing |
| Script syntax             | `node --check scripts/qb_bootstrap_mappings.js`                                           | `SYNTAX_OK`                                   | `SYNTAX_OK` |
| Import surface verified   | `grep 'export async function getValidAccessToken' backend/src/services/quickbooks/token-refresh.ts` | Exported with `(orgId, prismaClient?)` signature, returns `{accessToken, realmId}` | confirmed line 68 |
| Import surface verified   | `grep 'model QBEntityMapping' packages/database/prisma/schema.prisma`                     | Mapped to `qb_entity_mappings` with unique (org, entityType, localId)    | confirmed line 1059 |
| Script dry-run (prod)     | `docker cp … && docker exec kuwaitpos-backend node /tmp/qbb.js --dry-run`                 | Exit 0 if no QB entities missing, exit 2 if admin must create in QB      | _deferred — requires prod access; execute after merge as part of deploy_ |
| Required-mapping coverage | Script reports `mappingsCreated + mappingsAlreadyPresent = 7` (6 active + 1 verify-only)  | Matches the 7 rows in REQUIRED[]              | _deferred — prod run_ |
| Expense-account coverage  | Script reports `expenseAccountsVerified = 17`                                             | 17 matches the seed in `20260422_add_expenses` | _deferred — prod run_ |

### What changed / what did NOT change

- **Changed:** added one standalone Node script + its runbook.
- **Did NOT change:** any `apps/backend/src` code, any schema, any
  migration, any handler, any module service or controller, any web
  code. The Phase 2-5 handlers continue to resolve mappings the same
  way — bootstrap just ensures those mappings exist.

### Regression surface

Zero. Script is a read-from-QB + write-to-`qb_entity_mappings`
operation, invoked manually by the admin. It cannot be triggered by
the running application and shares no runtime path with request
handling.

---

## Task 2 — Unified per-customer ledger

### Scope

Merge `customer_advance_movements` (non-voided) into the existing
per-customer ledger view as two new entry types — `ADVANCE_DEPOSIT`
(IN → credit) and `ADVANCE_HANDOUT` (OUT → debit) — interleaved
chronologically with INVOICE / RECEIPT. Credit-sale code path
untouched (client directive: *"no need to change that area"*).

### Files changed

- `apps/backend/src/modules/credit/credit.service.ts`
  - new exported `LedgerEntryType` union
  - opening-balance UNION extended with `customer_advance_movements`
    (skipped when `vehicleNumber` filter is set)
  - main ledger UNION extended with advance movements (same guard)
  - row mapper uses `LedgerEntryType` cast
- `apps/backend/src/modules/credit/credit.schema.ts`
  - `entryType` enum extended to include the two new values
- `apps/web/src/api/credit.ts`
  - exported `LedgerEntryType`; `LedgerEntry.type` + `entryType` filter extended
- `apps/web/src/pages/Credit.tsx`
  - new row renderer branches: distinct badge (outline + amber border)
    and row background tint for advance movements; label collapsed to
    `ADV IN` / `ADV OUT` for compact display

### Pre-change checks

| Check                      | Command                                       | Result       |
| -------------------------- | --------------------------------------------- | ------------ |
| Backend typecheck          | `cd apps/backend && npx tsc --noEmit`         | PASS         |
| Web typecheck              | `cd apps/web && npx tsc --noEmit`             | PASS         |
| credit module jest         | `npx jest --testPathPattern='credit'`         | 31/31        |

### Post-change checks

| Check                      | Command                                       | Result       |
| -------------------------- | --------------------------------------------- | ------------ |
| Backend typecheck          | `cd apps/backend && npx tsc --noEmit`         | PASS (exit 0) |
| Web typecheck              | `cd apps/web && npx tsc --noEmit`             | PASS (exit 0) |
| credit module jest         | `npx jest --testPathPattern='credit'`         | 31/31 (no regression) |

**Delta: zero.** No pre-existing test failed or changed behavior.

### What changed / what did NOT change

- **Changed:** ledger read path (`getCustomerLedger` SQL + type
  surface), Credit.tsx row renderer.
- **Did NOT change:** any sales-creation path (fuel sales, backdated
  transactions, credit invoice logic), any receipt-creation path, any
  balance-calculation function other than the display-time running
  total (same `debit - credit` accumulator), any advance movement
  creation/void path (`customer-advance.service.ts` untouched).

### Running-balance math

| Entry                   | debit | credit | Effect on running balance |
| ----------------------- | ----- | ------ | ------------------------- |
| INVOICE (existing)      | > 0   | 0      | += debit                  |
| RECEIPT (existing)      | 0     | > 0    | -= credit                 |
| ADVANCE_DEPOSIT (new)   | 0     | amount | -= amount (reduces AR)    |
| ADVANCE_HANDOUT (new)   | amount | 0     | += amount (increases AR)  |

### End-to-end validation (deferred to deploy-time smoke)

Requires a seeded customer with an advance deposit + credit invoice.
After Task 2 deploys, verify via curl:

```bash
JWT=$(curl -sk -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"AdminPass123"}' | jq -r .token)

curl -sk -H "Authorization: Bearer $JWT" \
  "https://kuwaitpos.duckdns.org/api/credit/customers/<customerId>/ledger?limit=50" \
  | jq '.data.entries | map({date, type, description, debit, credit, balance})'
```

Expected: chronologically interleaved INVOICE / RECEIPT /
ADVANCE_DEPOSIT / ADVANCE_HANDOUT entries with strictly consistent
running balance. Also verify `entryType=ADVANCE_DEPOSIT` filter
returns only deposits.

---

## Task 3 — Tests for Phases 2-5

_Pending._

---

## Task 4 — Reports page additions

_Pending._
