# Deployment Rules (Mandatory)

## Canonical Command

```bash
./scripts/deploy.sh [auto|full|backend-only|frontend-only]
```

No manual `ssh`, `docker build`, `docker compose up`, or ad-hoc `scp` during production deploy.

Default mode is `auto`.

## What `deploy.sh` Enforces

1. Clean git tree check (hard fail)
2. Remote connectivity preflight
3. Change detection vs currently deployed server commit
4. Smart plan selection:
   - `auto`: deploy only changed surfaces
   - `backend-only`: backend path only
   - `frontend-only`: frontend path only
   - `full`: both backend + frontend
5. Remote deployment lock (`/tmp/kuwaitpos-deploy-lock`) to block concurrent deploys
6. Commit pinning (remote HEAD must match local commit hash)
7. Conditional backend deploy (`docker compose build backend` then `up -d backend`) only when needed
8. Conditional frontend atomic swap (`dist_new -> dist`, previous kept as `dist_prev`) only when needed
9. API health verification (`/api/health` retry loop)

## Non-Negotiable Rules

1. Never run deploy steps in background during production rollout.
2. Never run parallel deploy commands from multiple terminals.
3. Never use `--no-cache` unless debugging a confirmed cache issue.
4. Never use `git reset --hard` on server as part of normal deploy.
5. Never claim deployment success without script completion and health pass.
6. Prefer `auto` mode for day-to-day deploys.
7. Use `full` mode only when deploy tooling/runtime dependencies changed.
8. For frontend-only changes, use `frontend-only` if `auto` cannot infer correctly.
9. For backend-only changes, use `backend-only` if `auto` cannot infer correctly.

## Standard Usage

```bash
./scripts/deploy.sh
```

Mode examples:

```bash
./scripts/deploy.sh auto
./scripts/deploy.sh frontend-only
./scripts/deploy.sh backend-only
./scripts/deploy.sh full
```

Optional environment overrides:

```bash
SERVER_HOST=64.226.65.80 SERVER_USER=root SERVER_PATH=~/kuwait-pos ./scripts/deploy.sh
```

## Failure Handling

- If lock exists: wait for active deploy to finish; do not bypass lock.
- If commit mismatch: push local commit first, re-run script.
- If health check fails: treat deploy as failed and investigate backend logs before any further deploy attempt.

## Server Hygiene (Docker)

Use only safe cleanup commands that do not touch running containers or data volumes:

```bash
docker image prune -f
docker builder prune -af
```

Avoid destructive cleanup in production:
- `docker system prune -a --volumes` (can remove required data)
- ad-hoc deletion under `/var/lib/docker`
