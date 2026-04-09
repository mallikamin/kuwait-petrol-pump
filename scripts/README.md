# Deployment Scripts

## Production Deploy

### `deploy.sh`
Canonical and only approved production deploy path.

Usage:
```bash
./scripts/deploy.sh
```

What it does (enforced):
- clean git guard
- local backend + frontend build
- remote deploy lock
- commit pin check
- serial backend rollout
- frontend atomic swap
- API health verification

Optional env overrides:
```bash
SERVER_HOST=64.226.65.80 SERVER_USER=root SERVER_PATH=~/kuwait-pos ./scripts/deploy.sh
```

## Utility Scripts

- `require-clean-git.sh`: blocks build/deploy on dirty tree
- `backup-db.sh`: manual DB backup helper
- `restore-db.sh`: DB restore helper
- `health-check.sh`: container + API health checks

## Rules

See `scripts/DEPLOY_RULES.md` for mandatory policy.
