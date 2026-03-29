#!/bin/bash
# Kuwait POS - Quick Deployment Reference
# Run line-by-line, NOT as a script (inspect output after each command)
#
# Target host: set from your deployment notes (Windows: `.env.server` -> `DROPLET_IP`, local-only; do not commit)
export DROPLET_IP="<fill-from-.env.server:DROPLET_IP>"

# ============================================
# PHASE 1: BACKUP (MANDATORY)
# ============================================
ssh root@"$DROPLET_IP"
cd /root/kuwait-pos
mkdir -p /root/backups
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker exec kuwaitpos-postgres pg_dump -U postgres kuwait_pos | gzip > /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz
ls -lh /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz  # Must be > 1KB
cp .env .env.backup-$TIMESTAMP

# ============================================
# PHASE 2: CODE UPDATE
# ============================================
git pull origin master
ls -lh packages/database/prisma/migrations/20260328063646_tenant_scoped_uniqueness/migration.sql

# ============================================
# PHASE 3: DEPLOY
# ============================================
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d
sleep 30
docker compose -f docker-compose.prod.yml ps  # All should be "Up"

# ============================================
# PHASE 4: MIGRATE
# ============================================
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status  # Should say "up to date"

# ============================================
# PHASE 5: SMOKE TESTS
# ============================================
apt-get update && apt-get install -y jq

# Health check
curl -sS https://kuwaitpos.duckdns.org/api/health

# Auth test (REPLACE username/password)
TOKEN=$(curl -sS -X POST https://kuwaitpos.duckdns.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' | jq -r '.access_token')
echo "Token: ${TOKEN:0:40}"

# Sync test
curl -sS https://kuwaitpos.duckdns.org/api/sync/status -H "Authorization: Bearer $TOKEN"

# Idempotency test (REPLACE UUIDs)
cat > /tmp/sync-test.json <<'JSON'
{
  "deviceId": "test-1",
  "sales": [{
    "offlineQueueId": "test-001",
    "branchId": "REAL_BRANCH_UUID",
    "shiftInstanceId": "REAL_SHIFT_UUID",
    "saleDate": "2026-03-28T12:00:00Z",
    "saleType": "fuel",
    "totalAmount": 1000,
    "taxAmount": 0,
    "discountAmount": 0,
    "paymentMethod": "cash",
    "cashierId": "REAL_USER_UUID",
    "fuelSales": []
  }]
}
JSON

# First call (should sync)
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/sync-test.json | jq

# Second call (should be idempotent - no duplicate)
curl -sS -X POST https://kuwaitpos.duckdns.org/api/sync/queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/sync-test.json | jq

# Verify count = 1 (not 2)
docker exec kuwaitpos-postgres psql -U postgres kuwait_pos -c \
  "SELECT COUNT(*) FROM \"Sale\" WHERE \"offlineQueueId\" = 'test-001';"

# ============================================
# PHASE 6: VERIFY
# ============================================
docker compose -f docker-compose.prod.yml logs backend | tail -100  # No errors
docker stats --no-stream  # RAM < 1GB total
curl -v https://kuwaitpos.duckdns.org/api/health 2>&1 | grep "SSL certificate verify ok"

# ============================================
# SUCCESS CRITERIA
# ============================================
# ✅ All services "Up"
# ✅ /api/health returns 200
# ✅ Login returns valid token
# ✅ Sync status accessible
# ✅ Duplicate sync rejected (idempotency working)
# ✅ No errors in logs
# ✅ SSL certificate valid
# ✅ RAM usage < 1GB

# ============================================
# ROLLBACK (IF ANYTHING FAILS)
# ============================================
# docker compose -f docker-compose.prod.yml stop backend
# docker exec kuwaitpos-postgres psql -U postgres -c "DROP DATABASE kuwait_pos;"
# docker exec kuwaitpos-postgres psql -U postgres -c "CREATE DATABASE kuwait_pos;"
# gunzip -c /root/backups/kuwait-pre-deploy-$TIMESTAMP.sql.gz | docker exec -i kuwaitpos-postgres psql -U postgres kuwait_pos
# git reset --hard <PREVIOUS_COMMIT_HASH>
# docker compose -f docker-compose.prod.yml build backend
# docker compose -f docker-compose.prod.yml up -d
