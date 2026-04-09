# Deployment Rules (Mandatory)

## Canonical Command

```bash
./scripts/deploy.sh
```

No manual `ssh`, `docker build`, `docker compose up`, or ad-hoc `scp` during production deploy.

## What `deploy.sh` Enforces

1. Clean git tree check (hard fail)
2. Local backend + frontend build (hard fail if artifacts missing)
3. Remote connectivity preflight
4. Remote deployment lock (`/tmp/kuwaitpos-deploy-lock`) to block concurrent deploys
5. Commit pinning (remote HEAD must match local commit hash)
6. Serial backend deploy (`docker compose build backend` then `up -d backend`)
7. Frontend atomic swap (`dist_new -> dist`, previous kept as `dist_prev`)
8. API health verification (`/api/health` retry loop)

## Non-Negotiable Rules

1. Never run deploy steps in background during production rollout.
2. Never run parallel deploy commands from multiple terminals.
3. Never use `--no-cache` unless debugging a confirmed cache issue.
4. Never use `git reset --hard` on server as part of normal deploy.
5. Never claim deployment success without script completion and health pass.

## Standard Usage

```bash
./scripts/deploy.sh
```

Optional environment overrides:

```bash
SERVER_HOST=64.226.65.80 SERVER_USER=root SERVER_PATH=~/kuwait-pos ./scripts/deploy.sh
```

## Failure Handling

- If lock exists: wait for active deploy to finish; do not bypass lock.
- If commit mismatch: push local commit first, re-run script.
- If health check fails: treat deploy as failed and investigate backend logs before any further deploy attempt.
