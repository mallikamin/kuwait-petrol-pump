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
SERVER_APP_URL="${SERVER_APP_URL:-https://kuwaitpos.duckdns.org}"
DEPLOY_LOCK_DIR="/tmp/kuwaitpos-deploy-lock"

echo "Kuwait POS Production Deploy"
echo "============================"
echo "Target: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"
echo

echo "Step 1/8: Enforcing clean git tree..."
bash "$SCRIPT_DIR/require-clean-git.sh"
COMMIT_HASH="$(git rev-parse --short HEAD)"
echo "Commit: ${COMMIT_HASH}"
echo

echo "Step 2/8: Building backend (local)..."
(cd apps/backend && npm run build)
if [ ! -d "apps/backend/dist" ]; then
  echo "ERROR: apps/backend/dist not found after build"
  exit 1
fi
echo "Backend build OK"
echo

echo "Step 3/8: Building frontend (local)..."
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
echo

echo "Step 4/8: Connectivity preflight..."
ssh "${SERVER_USER}@${SERVER_HOST}" "echo 'Remote reachable: ' \$(hostname)"
echo

echo "Step 5/8: Deploy backend (serial + lock + commit pin)..."
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

docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml ps backend
"
echo "Backend deploy OK"
echo

echo "Step 6/8: Deploy frontend (atomic swap)..."
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
echo

echo "Step 7/8: Post-deploy health checks..."
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

echo "Step 8/8: Deployment proof"
echo "Deployed commit: ${COMMIT_HASH}"
echo "Frontend bundle: $(basename "$FRONTEND_BUNDLE")"
echo "API URL: ${SERVER_APP_URL}/api/health"
echo
echo "SUCCESS: production deploy completed with enforced guardrails."

