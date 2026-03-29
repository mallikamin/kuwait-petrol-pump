# Claude Master Context + Production Cutover Prompt

Date: 2026-03-29

## Non-Negotiable Architecture Decisions
1. Desktop app is REQUIRED for offline capabilities.
2. Mobile app is also required for operator workflows.
3. Backend API is the central integration and sync authority.
4. Do not mark desktop as deprecated unless explicit written approval is provided in this repo.

Target architecture:
- apps/backend (required)
- apps/web (required)
- apps/desktop (required)
- apps/mobile (required, currently not release-ready)

## Verified Technical Reality (evidence-first)
- Backend build passes and QuickBooks hardening test suite passes.
- Backend current verified totals:
  - Task 4 set: 99/99
  - Task 5 specific: 49/49
  - Combined: 148/148
- Root folder was cleaned; historical status/evidence files were moved to:
  - archive/root-cleanup-2026-03-29/
- Mobile type-check currently has real TS errors and is not release-ready.
- Web/Desktop build verification may be environment-sensitive (EPERM in restricted shell); must be re-verified on CI or normal host runner.

## Reporting Guardrails (must follow)
1. Never claim completion without command evidence.
2. Report exact command output totals; no invented line counts.
3. If endpoint names are listed, verify against actual routes.ts before reporting.
4. Separate "implemented" from "production-cutover prerequisites".

## Production Cutover Prerequisites (must complete before FULL_SYNC)
1. Run DB migrations on target env:
   - npx prisma migrate deploy
2. Ensure required QB entity mappings exist per org:
   - walk-in customer
   - payment methods (cash, card minimum)
   - active fuel item mappings
3. Confirm QuickBooks production credentials + redirect URI are configured.
4. Execute phased rollout:
   - READ_ONLY -> DRY_RUN -> FULL_SYNC
5. Validate using preflight endpoint and logs before each phase transition.

## Immediate Tasking Prompt for Claude
Use this exact prompt:

---
Task: Final production-cutover execution prep and consistency pass.

Repo:
C:\ST\Sitara Infotech\Kuwait Petrol Pump\kuwait-petrol-pump

Hard constraints:
1) Treat Desktop as REQUIRED architecture component. Do NOT propose deprecating apps/desktop.
2) Evidence-first reporting only (commands + outputs).
3) Do not re-introduce drift in status docs.

Work items:
A. Consistency audit and fixes
- Audit docs/routes/status references for outdated/incorrect claims:
  - Any claim that Desktop is deprecated
  - Any outdated QB endpoint naming (must match actual routes)
  - Any wrong test counts/line counts
- Patch only what is incorrect.

B. Production cutover checklist validation
- Validate and document exact commands for:
  - migration deploy
  - preflight check
  - mappings verification
  - controls transition (READ_ONLY/DRY_RUN/FULL_SYNC)
- Ensure rollback commands are explicit and tested syntactically.

C. Safety endpoint compatibility cleanup (if low risk)
- Review legacy /safety-gates/sync-mode endpoint using WRITE_ENABLED wording.
- Keep backward compatibility, but align messages/docs to FULL_SYNC terminology.
- Add/adjust tests if you touch behavior.

D. Full verification run
- npm run build -w apps/backend
- npm run test -w apps/backend -- --runInBand fuel-sale.handler.test.ts job-dispatcher.test.ts queue-processor.service.test.ts entity-mapping.service.test.ts routes.test.ts preflight.service.test.ts error-classifier.test.ts

Strict output format:
A) Commands run
B) Files changed
C) Acceptance PASS/FAIL by section (A-D)
D) Remaining blockers for production cutover only

---
