<!-- Delete sections that don't apply. Keep it short. -->

## Summary
<!-- 1-3 bullets: what changed and why -->
-

## Risk Level
<!-- low / medium / high + one-line justification -->
**Level:**

## Test Evidence
<!-- screenshots, CI links, manual test notes, or "N/A: docs-only" -->

## Rollback Plan
<!-- exact commands, revert PR, or "revert PR — no state change" -->

## Deploy-Sensitive Checklist
<!-- If this touches ANY of:
     - .github/workflows/deploy*
     - scripts/deploy*
     - docker-compose*.yml
     - nginx/**
     apply the `prod-safe-approved` label before requesting merge.
     The pr-guard advisory will warn otherwise. -->
- [ ] No deploy-sensitive paths touched, OR `prod-safe-approved` label applied
