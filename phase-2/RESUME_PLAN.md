# Post-Initial Delivery Resume Plan (No Accounting/Reconciliation Logic Changes)

## Phase 0: Freeze Baseline (same day as initial delivery)
1. Tag release commit (`release/initial-qb-banks`).
2. Capture baseline metrics:
- backdated save failures/day
- QB mapping dropdown errors/day
- support tickets on "data missing"
3. Open a single tracking epic with 8 tasks below.

## Phase 1 (P0): Stability Hardening
1. Backdated page split (component/hook extraction only).
2. Save-state UX banner (`Saved/Unsaved/Failed`) + finalize guard on failed save.
3. Query/storage key normalization for `branch/date/shift`.
4. SafeSelect wrapper for dropdown reliability.

### Acceptance for Phase 1
1. No behavior changes in accounting outputs.
2. Existing API payloads unchanged.
3. Backdated and QB mapping smoke tests pass.
4. No regressions in save/finalize flow.

## Phase 2 (P1): Operational Safety + Observability
1. Replace noisy `console.*` with structured logger wrappers.
2. Add production guardrails to destructive scripts (`clear-test-data` confirm gates).
3. Add executable UAT smoke script (API checks, pass/fail output).

### Acceptance for Phase 2
1. Production logs are searchable by request/correlation ID.
2. Destructive scripts cannot run in prod without explicit override.
3. Smoke script reproducibly validates gates in <5 minutes.

## Phase 3 (P1): Regression Prevention
1. Add targeted tests:
- QB mapping dropdown selection persistence
- backdated draft restore behavior
- bank-card bank selection required
2. Add CI job for these targeted tests only (fast lane).

### Acceptance for Phase 3
1. New tests run in CI and block merges on failure.
2. Reproduced historical dropdown/data-visibility issues are covered by tests.

## Execution Model (when resumed)
1. Sprint A (2-3 days): Phase 1 only.
2. Sprint B (1-2 days): Phase 2.
3. Sprint C (1-2 days): Phase 3.

## Resume Trigger
1. Initial version deployed and UAT sign-off recorded.
2. No P0 production outage in previous 24 hours.
3. Branch cut from release tag, then execute Phase 1 first.
