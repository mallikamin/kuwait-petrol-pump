#!/bin/bash
# Canonical Deploy Script for Kuwait Petrol Pump POS
# Enforces git-clean guard at deploy time (cannot be bypassed)

set -e  # Exit on any error

echo "🚀 Kuwait POS Deploy Script"
echo "=============================="
echo ""

# GUARD: Enforce clean git tree (MANDATORY)
echo "Step 1/6: Checking git tree..."
bash "$(dirname "$0")/require-clean-git.sh"
echo ""

# Capture commit for deployment
COMMIT_HASH=$(git rev-parse --short HEAD)
echo "Step 2/6: Deploying commit $COMMIT_HASH"
echo ""

# Build backend
echo "Step 3/6: Building backend..."
cd apps/backend
npm run build  # Will run prebuild guard again (defense in depth)
cd ../..
echo "✅ Backend build complete"
echo ""

# Build frontend
echo "Step 4/6: Building frontend..."
cd apps/web
npm run build  # Will run prebuild guard again (defense in depth)
cd ../..
echo "✅ Frontend build complete"
echo ""

# Verify builds exist
echo "Step 5/6: Verifying build artifacts..."
if [ ! -d "apps/backend/dist" ]; then
    echo "❌ ERROR: Backend dist/ not found"
    exit 1
fi
if [ ! -d "apps/web/dist" ]; then
    echo "❌ ERROR: Frontend dist/ not found"
    exit 1
fi
echo "✅ Build artifacts verified"
echo ""

# Deployment instructions
echo "Step 6/6: Deploy Instructions"
echo "=============================="
echo "Commit to deploy: $COMMIT_HASH"
echo ""
echo "Backend (Docker on server):"
echo "  ssh root@64.226.65.80"
echo "  cd ~/kuwait-pos"
echo "  git fetch && git checkout $COMMIT_HASH"
echo "  docker build -f Dockerfile.prod -t kuwaitpos-backend:$COMMIT_HASH ."
echo "  docker tag kuwaitpos-backend:$COMMIT_HASH kuwaitpos-backend:latest"
echo "  docker compose -f docker-compose.prod.yml up -d backend"
echo ""
echo "Frontend (Atomic swap on server):"
echo "  scp -r apps/web/dist root@64.226.65.80:~/kuwait-pos/apps/web/dist_new"
echo "  ssh root@64.226.65.80 'cd ~/kuwait-pos/apps/web && mv dist dist_old && mv dist_new dist'"
echo "  ssh root@64.226.65.80 'docker compose -f docker-compose.prod.yml restart nginx'"
echo ""
echo "✅ Build complete. Ready for server deployment."
echo ""
echo "REMINDER: Follow verification gates from CLAUDE.md after deployment."
