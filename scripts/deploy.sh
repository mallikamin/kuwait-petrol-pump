#!/usr/bin/env bash
# Canonical production deployment script for Kuwait Petrol Pump POS.
# Single-path, serial, lock-protected deploy to avoid drift and partial rollouts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SERVER_HOST="${SERVER_HOST:-64.226.65.80}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PATH="${SERVER_PATH:-~/kuwait-pos}"
SERVER_APP_URL="${SERVER_APP_URL:-https://fuelpos.sitaratech.info}"
DEPLOY_LOCK_DIR="/tmp/kuwaitpos-deploy-lock"
DEPLOY_MODE="${1:-auto}" # auto | full | backend-only | frontend-only

case "$DEPLOY_MODE" in
  auto|full|backend-only|frontend-only) ;;
  *)
    echo "ERROR: invalid deploy mode '$DEPLOY_MODE'"
    echo "Usage: ./scripts/deploy.sh [auto|full|backend-only|frontend-only]"
    exit 1
    ;;
esac

echo "Kuwait POS Production Deploy"
echo "============================"
echo "Target: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"
echo "Mode: ${DEPLOY_MODE}"
echo

echo "Step 1/8: Enforcing clean git tree..."
bash "$SCRIPT_DIR/require-clean-git.sh"
COMMIT_HASH="$(git rev-parse --short HEAD)"
COMMIT_HASH_FULL="$(git rev-parse HEAD)"
echo "Commit: ${COMMIT_HASH}"
echo

echo "Step 2/8: Connectivity preflight..."
ssh "${SERVER_USER}@${SERVER_HOST}" "echo 'Remote reachable: ' \$(hostname)"
echo

REMOTE_COMMIT_FULL="$(ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && git rev-parse HEAD")"
CHANGED_FILES="$(git diff --name-only "${REMOTE_COMMIT_FULL}" "${COMMIT_HASH_FULL}" || true)"

NEED_BACKEND=false
NEED_FRONTEND=false

if [ "$DEPLOY_MODE" = "full" ]; then
  NEED_BACKEND=true
  NEED_FRONTEND=true
elif [ "$DEPLOY_MODE" = "backend-only" ]; then
  NEED_BACKEND=true
elif [ "$DEPLOY_MODE" = "frontend-only" ]; then
  NEED_FRONTEND=true
else
  if echo "$CHANGED_FILES" | grep -Eq "^(apps/backend/|packages/database/|Dockerfile\.prod|docker-compose\.prod\.yml|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig\.json|scripts/deploy\.sh)"; then
    NEED_BACKEND=true
  fi
  if echo "$CHANGED_FILES" | grep -Eq "^(apps/web/|nginx/)"; then
    NEED_FRONTEND=true
  fi
fi

echo "Detected changes since remote commit ${REMOTE_COMMIT_FULL:0:7}:"
if [ -n "$CHANGED_FILES" ]; then
  echo "$CHANGED_FILES" | sed 's/^/  - /'
else
  echo "  - none"
fi
echo "Plan: backend=${NEED_BACKEND}, frontend=${NEED_FRONTEND}"
echo

echo "Step 3/8: Building backend (local, if needed)..."
if [ "$NEED_BACKEND" = "true" ]; then
  (cd apps/backend && npm run build)
  if [ ! -d "apps/backend/dist" ]; then
    echo "ERROR: apps/backend/dist not found after build"
    exit 1
  fi
  echo "Backend build OK"
else
  echo "Skipping local backend build (no backend-impacting changes)"
fi
echo

FRONTEND_BUNDLE="(skipped)"
echo "Step 4/8: Building frontend (local, if needed)..."
if [ "$NEED_FRONTEND" = "true" ]; then
  (cd apps/web && npm run build)
  if [ ! -d "apps/web/dist" ]; then
    echo "ERROR: apps/web/dist not found after build"
    exit 1
  fi
  FRONTEND_BUNDLE="$(ls -1 apps/web/dist/assets/index-*.js | head -n 1 || true)"
  if [ -z "$FRONTEND_BUNDLE" ]; then
    echo "ERROR: frontend JS bundle not found in apps/web/dist/assets"
    exit 1
  fi
  echo "Frontend build OK: $(basename "$FRONTEND_BUNDLE")"
else
  echo "Skipping local frontend build (no frontend-impacting changes)"
fi
echo

echo "Step 5/8: Sync commit on server (serial + lock + commit pin)..."
ssh "${SERVER_USER}@${SERVER_HOST}" "
set -euo pipefail
cd ${SERVER_PATH}

if ! mkdir '${DEPLOY_LOCK_DIR}' 2>/dev/null; then
  echo 'ERROR: another deployment is already running (lock: ${DEPLOY_LOCK_DIR})'
  exit 1
fi
trap 'rmdir ${DEPLOY_LOCK_DIR}' EXIT

git fetch origin
git checkout master
git pull --ff-only origin master

REMOTE_COMMIT=\$(git rev-parse --short HEAD)
if [ \"\$REMOTE_COMMIT\" != \"${COMMIT_HASH}\" ]; then
  echo \"ERROR: remote HEAD \$REMOTE_COMMIT does not match local commit ${COMMIT_HASH}\"
  exit 1
fi

if [ \"${NEED_BACKEND}\" = \"true\" ]; then
  docker compose -f docker-compose.prod.yml build backend
  docker compose -f docker-compose.prod.yml up -d backend
  docker compose -f docker-compose.prod.yml ps backend
else
  echo 'Skipping backend docker build/restart (no backend-impacting changes)'
fi
"
echo "Server sync OK"
echo

echo "Step 6/8: Apply pending database migrations..."
ssh "${SERVER_USER}@${SERVER_HOST}" "
set -euo pipefail
cd ${SERVER_PATH}

if [ \"${NEED_BACKEND}\" = \"true\" ]; then
  echo 'Running prisma migrate deploy...'
  MIGRATION_RESULT=\$(docker exec kuwaitpos-backend sh -c 'cd /app/packages/database && npx prisma migrate deploy' 2>&1 || true)
  echo \"\$MIGRATION_RESULT\"

  if echo \"\$MIGRATION_RESULT\" | grep -q 'All migrations have been successfully applied'; then
    echo 'Migration status: up to date ✅'
  elif echo \"\$MIGRATION_RESULT\" | grep -q 'No pending migrations to apply'; then
    echo 'Migration status: up to date ✅'
  elif echo \"\$MIGRATION_RESULT\" | grep -q 'found in prisma/migrations'; then
    echo 'Migration status: up to date ✅'
  else
    echo 'ERROR: migration validation failed'
    echo \"Output: \$MIGRATION_RESULT\"
    exit 1
  fi
else
  echo 'Skipping migrations (no backend-impacting changes)'
fi
"
echo
echo "Step 7/8: Deploy frontend (atomic swap)..."
if [ "$NEED_FRONTEND" = "true" ]; then
  scp -r apps/web/dist "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/apps/web/dist_new"
  ssh "${SERVER_USER}@${SERVER_HOST}" "
  set -euo pipefail
  cd ${SERVER_PATH}/apps/web
  rm -rf dist_prev
  if [ -d dist ]; then mv dist dist_prev; fi
  mv dist_new dist
  cd ${SERVER_PATH}
  docker compose -f docker-compose.prod.yml restart nginx
  "
  echo "Frontend deploy OK"
else
  echo "Skipping frontend deploy (no frontend-impacting changes)"
fi
echo

echo "Step 8/9: Post-deploy health checks..."
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && docker compose -f docker-compose.prod.yml ps"
for i in 1 2 3 4 5; do
  if curl -fsS "${SERVER_APP_URL}/api/health" >/dev/null 2>&1; then
    echo "API health check passed (attempt ${i})"
    break
  fi
  if [ "$i" -eq 5 ]; then
    echo "ERROR: API health check failed after 5 attempts"
    exit 1
  fi
  sleep 3
done
echo

echo "Step 9/9: Deployment proof"
echo "Deployed commit: ${COMMIT_HASH}"
if [ "$NEED_BACKEND" = "true" ]; then
  echo "Backend status: deployed"
  echo "Migration status: up to date"
else
  echo "Backend status: (unchanged)"
fi
if [ "$NEED_FRONTEND" = "true" ]; then
  echo "Frontend bundle: $(basename "$FRONTEND_BUNDLE")"
else
  echo "Frontend bundle: (unchanged)"
fi
echo "API URL: ${SERVER_APP_URL}/api/health"
echo
echo "SUCCESS: production deploy completed with enforced guardrails."
