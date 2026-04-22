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

_Pending — will be filled in when Task 1 merges._

---

## Task 3 — Tests for Phases 2-5

_Pending._

---

## Task 4 — Reports page additions

_Pending._
