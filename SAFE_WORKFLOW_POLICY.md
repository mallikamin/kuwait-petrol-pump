# Safe Workflow Policy (PR + Deploy)

Last updated: 2026-04-20

## Goals
- Keep production stable.
- Use PR workflow for contribution history and review quality.
- Make deployments explicit, auditable, and reversible.

## Required Git Flow
1. Never work directly on `master`.
2. Create branch: `feat/*`, `fix/*`, `chore/*`, or `hotfix/*`.
3. Open PR to `master` with scope, risk, and rollback notes.
4. Merge only after CI is green and reviewer checklist is done.
5. Prefer squash merge for clean history.

## Required Deploy Flow
1. Deploy only from a specific ref (`master` commit or release tag).
2. Production deploy must be manually triggered.
3. Deployment must include:
- pre-deploy backup/snapshot
- post-deploy health check
- rollback command sequence
4. Record deployment evidence in a dated markdown log.

## Release Tagging Standard
- Create immutable tag on each production release:
- `vYYYY.MM.DD-N`
- Example: `v2026.04.20-1`

## Hard Safety Rules
1. No unreviewed hot edits on production server.
2. No destructive cleanup during live deploy.
3. No migration on production without prior test run on clone/staging.
4. If critical checks fail, rollback immediately.

