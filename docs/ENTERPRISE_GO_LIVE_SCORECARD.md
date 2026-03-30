# Kuwait Petrol Pump - Enterprise Go-Live Scorecard

Last Updated: 2026-03-30 00:25:00 +05:00
Author: Codex
Scope: Whole application (Backend API, Web Dashboard, Desktop POS, Mobile App, Data/Infra/Ops)
Purpose: Single source of truth for production-readiness decisions with measurable, auditable criteria.

---

## 1) Executive Truth (Current Reality)

### 1.1 Architecture (Locked)
- Required apps:
  - apps/backend (system of record + integration authority)
  - apps/web (admin/reporting/operations UI)
  - apps/desktop (required for offline-capable POS operations)
  - apps/mobile (operator workflows and field operations)
- Decision lock:
  - Desktop is REQUIRED and must not be deprecated without explicit written decision.

### 1.2 Current Verified Engineering Baseline
- Backend:
  - Build passes.
  - QuickBooks hardening suites pass (148/148).
- Web/Desktop:
  - Web host-runner verification completed for Task 6.1 remediation:
    - QuickBooks panel tests pass (14/14).
    - `apps/web` production build passes (TypeScript + Vite, 0 errors).
    - Task 6.1 remediation committed on branch `chore/stabilize-qb-cutover-2026-03-29` at `db143ba`.
  - Web host-runner verification completed for Task 6 scaffold (2026-03-29):
    - QuickBooks component tests pass (14/14): ControlsPanel.test.tsx (6/6), MappingsPanel.test.tsx (8/8).
    - `apps/web` production build passes (TypeScript + Vite, 0 errors, bundle 954.91 kB).
    - Test harness complete: vitest config, test setup utilities, component tests.
    - Task 6 scaffold pending commit (separate from Task 6.1).
  - Restricted shell EPERM process-spawn limitation still applies for some local sandbox runs.
- Mobile:
  - Type-check currently reports real TS issues; not release-ready.

### 1.3 Readiness Estimate (Reality-Based)
- Backend: 90-95% (cutover execution pending).
- Web: 80-85% (production build verification + ops UI completion/validation).
- Desktop: 70-80% (build/package validation + offline QA).
- Mobile: 50-60% (TS stabilization + device QA + distribution).
- Whole product: 70-80%.

---

## 2) Target Quality Bar (Enterprise, Non-Fluff)

This scorecard uses objective gates. A component is production-ready only when all P0 items are green and no unresolved critical risks remain.

Scoring model:
- P0 = ship blocker
- P1 = required for stable first 60 days
- P2 = optimization/future hardening

Status values:
- Green: done and evidence-backed
- Yellow: partially done or unverified
- Red: missing or failing

---

## 3) Cross-Cutting Non-Functional Requirements (All Apps)

### 3.1 UX/UI System Quality

#### P0
- Consistent design tokens across web/desktop/mobile:
  - typography scale, spacing scale, color tokens, states, semantic colors, component radii/shadows.
- Accessibility baseline:
  - keyboard nav for critical workflows (web/desktop)
  - contrast >= WCAG AA for text and controls
  - focus-visible styles present
  - form errors announced and visibly mapped to fields.
- Critical workflow UX latency budget:
  - perceived response for core actions < 300ms local UI feedback.

#### P1
- Unified font strategy:
  - approved font families with fallback stacks
  - no random per-page font drift
  - readable numeric font for POS totals.
- UI observability:
  - UI error boundary and user-safe fallback for failed network actions.

#### P2
- Micro-interaction polish and advanced responsiveness.

Evidence required:
- token file(s), screenshots, and workflow QA checklist with pass/fail logs.

---

### 3.2 Security & Compliance

#### P0
- AuthN/AuthZ:
  - role checks enforced server-side for all sensitive routes.
  - no trust of client-provided org IDs.
- Data isolation:
  - organization scoping enforced for every tenant-sensitive query.
- Secrets:
  - no secrets in repo
  - env-based secrets on server
  - rotation checklist documented.
- Input validation:
  - schema validation on write endpoints.

#### P1
- Audit trail coverage:
  - every control change, critical write, auth event logged with actor + timestamp + metadata.
- Security headers/rate limits verified in production config.

#### P2
- Threat model + abuse-case tests.

Evidence required:
- endpoint audit matrix, authz tests, and production env checklist.

---

### 3.3 Performance, Latency, and Scalability

#### P0
- API P95 latency targets:
  - read endpoints: <= 300ms under expected load
  - write endpoints: <= 500ms excluding external vendor latency.
- Queue behavior:
  - no job-loss on restart
  - retry/backoff/dead-letter proven by tests.

#### P1
- DB indexes verified for hot paths.
- Payload size and response-time monitoring in prod.

#### P2
- load test and capacity envelope (users, sales/min, queue throughput).

Evidence required:
- benchmark report, DB explain plans, and queue metrics snapshots.

---

### 3.4 Reliability, Robustness, and Operability

#### P0
- Health/readiness endpoints reliable.
- Kill switch and mode controls (READ_ONLY, DRY_RUN, FULL_SYNC) functional and audited.
- Preflight checks gate production writes.
- Rollback procedure tested (not only documented).

#### P1
- Backup + restore drill completed and timed.
- Alert thresholds set for critical failure modes.

#### P2
- chaos/failure-injection tests.

Evidence required:
- runbook execution logs with timestamps and outcomes.

---

## 4) Component-Specific Exit Criteria

### 4.1 Backend API (Node/Express/Prisma/Redis)

#### P0 gates
- Build: pass, zero TS errors.
- Tests:
  - all critical suites pass (currently 148/148 baseline).
- Multi-tenant safety:
  - all org-scoped reads/writes verified.
- QuickBooks controls:
  - preflight endpoint, controls endpoints, dry-run behavior verified.
- Error taxonomy:
  - classified failures emitted with stable operational prefixes.

#### P1 gates
- Open-handle warnings in test runs resolved (Jest did not exit warning).
- Legacy route semantics cleaned where confusing (e.g., WRITE_ENABLED wording compatibility surface).
- Endpoint contract docs synchronized with actual router definitions.

#### P2 gates
- Perf budget dashboard and periodic load tests.

Current status snapshot:
- P0: mostly Green
- P1: Yellow (open handles + docs/legacy semantics consistency)
- P2: Yellow/Red

---

### 4.2 Web Dashboard (React/Vite)

#### P0 gates
- Production build verified in unrestricted runner/CI:
  - ✅ Host-runner build passes (2026-03-29): TypeScript + Vite, 0 errors, 954.91 kB bundle.
- Auth-protected flows working end-to-end against live backend:
  - ⏸️ Code-level verification complete (2026-03-29 23:40):
    - ✅ ProtectedRoute wraps /quickbooks route (App.tsx:32-35, :72)
    - ✅ JWT interceptor configured (api/client.ts:14-25)
    - ✅ 401 logout+redirect logic present (api/client.ts:28-36)
    - ✅ Auth store with persistence (store/auth.ts)
    - ✅ Live backend accessible (kuwaitpos.duckdns.org returns 200)
  - ⏸️ Manual E2E validation required (no test credentials per security policy).
- QuickBooks admin operational UI complete:
  - ✅ Kill switch toggle: implemented in ControlsPanel with confirmation dialogs.
  - ✅ Sync mode selector: implemented with READ_ONLY/DRY_RUN/FULL_SYNC guardrails.
  - ✅ Mappings UI: ControlsPanel + MappingsPanel + QuickBooks page scaffold with tabs.
  - ✅ Preflight trigger/results (2026-03-29 23:40):
    - ✅ PreflightPanel fully implemented (169 lines, not stub).
    - ✅ API integration: quickbooksApi.getPreflight() connected.
    - ✅ UI complete: status badges, checks table, CTA guidance, error handling.
    - ✅ Integrated in QuickBooks page Preflight tab.

#### P1 gates
- Bundle optimization plan if > target budgets.
- Role-based UI affordances and safe disabled states:
  - ✅ Admin/manager role checks present in ControlsPanel and MappingsPanel.

#### P2 gates
- Route-level code splitting and performance tuning.

Current status snapshot:
- P0: Red (manual E2E validation FAILED - white screen on authenticated routes)
- P1: Yellow
- P2: Yellow

Evidence:
- docs/reports/WEB_P0_CLOSEOUT_2026-03-29.md (code-level verification)
- docs/reports/WEB_P0_E2E_FAILURE_2026-03-30.md (E2E failure report)

---

### 4.3 Desktop POS (Electron - Required)

#### P0 gates
- Build and package verification in CI/host environment.
- Offline-first critical flows proven:
  - sale creation offline
  - queue persistence across app restarts
  - deterministic replay on reconnection.
- POS resilience:
  - graceful backend outage behavior
  - no data loss under intermittent connectivity.

#### P1 gates
- Installer signing/update strategy finalized.
- Crash logging + recoverability workflow.

#### P2 gates
- Hardware/peripheral hardening (printers/scanners if in scope).

Current status snapshot:
- P0: Yellow
- P1: Yellow/Red
- P2: Yellow

---

### 4.4 Mobile App (React Native/Expo)

#### P0 gates
- Type-check clean (currently failing; must be fixed first).
- Device QA pass for core workflows:
  - auth/session stability
  - meter reading capture
  - OCR fallback path
  - offline queue + replay.

#### P1 gates
- Packaging/distribution decision + dry run (EAS/MDM/internal APK/IPA).
- Telemetry/error reporting on device.

#### P2 gates
- OCR accuracy benchmarks by environment conditions.

Current status snapshot:
- P0: Red/Yellow
- P1: Yellow
- P2: Red

---

### 4.5 Database + Infra + Ops

#### P0 gates
- Production migrations applied cleanly.
- Backup job exists AND restore drill validated.
- TLS, reverse proxy, and service health checks green.

#### P1 gates
- Resource alerts (CPU/mem/disk/DB connections/queue lag).
- Dependency/version patching cadence.

#### P2 gates
- HA/DR strategy documented and rehearsed.

Current status snapshot:
- P0: Yellow (restore drill + final cutover execution)
- P1: Yellow
- P2: Red/Yellow

---

## 5) Cutover Plan (Command-Level)

Phase 0 - Pre-cutover verification:
1. Backend build and full critical tests.
2. Confirm mappings exist for each org.
3. Run preflight endpoint and capture result artifact.

Phase 1 - READ_ONLY:
1. Confirm OAuth connection and health.
2. Monitor logs/alerts without writes.

Phase 2 - DRY_RUN:
1. Enable DRY_RUN via controls.
2. Process representative transactions.
3. Validate generated payload/audit trails and failure taxonomy.

Phase 3 - FULL_SYNC:
1. Controlled enablement window.
2. Closely monitor queue, error classifications, latency, and rollback readiness.
3. Maintain immediate rollback path to READ_ONLY/kill switch.

Rollback (must be executable within minutes):
- activate kill switch
- switch to READ_ONLY
- pause workers if needed
- investigate with classified logs and audit trail

---

## 6) Risk Register (Top Practical Risks)

1. Mobile app instability due to unresolved TS/API mismatches.
2. Desktop offline path not fully verified under realistic outage simulations.
3. Documentation drift causing operators to use stale endpoints/modes.
4. Production cutover performed without per-org mapping completeness.
5. Open-handle leaks in tests indicating latent lifecycle cleanup issues.

---

## 7) Definition of Done (Whole Product)

All of the following must be true:
- Backend P0 gates: Green
- Web P0 gates: Green
- Desktop P0 gates: Green
- Mobile P0 gates: Green
- Infra/Ops P0 gates: Green
- Production cutover rehearsal completed with documented evidence
- Decision log updated with exact timestamps and command outputs

Until then, status is: Operationally progressing, not fully enterprise-production complete.

---

## 8) Working Protocol for Codex + Claude

1. Evidence-first updates only (command + output).
2. Never claim production readiness on unverified components.
3. Keep this scorecard updated whenever a P0/P1 gate changes state.
4. If architecture ambiguity appears, default to this file + explicit user instruction.
