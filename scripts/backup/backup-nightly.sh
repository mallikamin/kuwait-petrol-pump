#!/usr/bin/env bash
# Kuwait POS nightly backup
# - Full pg_dump (custom format, compressed)
# - Uploads tar
# - Per-tenant CSV bundles for accountant audit
# - Rotation: 7 daily / 4 weekly / 6 monthly
# - Writes status JSON at .last-run.json (consumed by edge alerter)
set -euo pipefail

BACKUP_ROOT=/root/kuwait-pos/backups
UPLOADS_SRC=/opt/kuwaitpos/data/uploads
PG_CONTAINER=kuwaitpos-postgres
TS=$(date +%F)              # 2026-05-02
TS_FULL=$(date +%FT%H%M%S)  # 2026-05-02T093000
STATUS_FILE="$BACKUP_ROOT/.last-run.json"
LOG_FILE="$BACKUP_ROOT/.last-run.log"

# -- ensure dirs
mkdir -p "$BACKUP_ROOT"/{db,uploads,tenants}

# -- start log fresh
exec > >(tee "$LOG_FILE") 2>&1
echo "[$(date -Iseconds)] backup-nightly.sh START ts=$TS_FULL"

# -- failure trap: write FAIL status JSON, exit non-zero
on_fail() {
  local lineno=$1
  local err=$2
  cat > "$STATUS_FILE" <<JSON
{
  "status": "fail",
  "ts": "$(date -Iseconds)",
  "ts_date": "$TS",
  "host": "$(hostname)",
  "error": "line $lineno exit $err",
  "log_tail": $(tail -20 "$LOG_FILE" | jq -Rs . 2>/dev/null || echo '"see log"')
}
JSON
  echo "[$(date -Iseconds)] FAIL line=$lineno exit=$err"
  exit "$err"
}
trap 'on_fail $LINENO $?' ERR

# -- 1. Full DB dump (custom format = compressed + restorable selectively)
DB_FILE="$BACKUP_ROOT/db/${TS}.dump"
echo "[1/4] pg_dump -> $DB_FILE"
docker exec "$PG_CONTAINER" bash -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9' \
  > "$DB_FILE"
DB_SIZE=$(stat -c %s "$DB_FILE")
echo "      dump size: $DB_SIZE bytes ($(numfmt --to=iec-i --suffix=B "$DB_SIZE"))"

# -- 2. Uploads tar (skip if dir empty/missing)
UPL_FILE="$BACKUP_ROOT/uploads/${TS}.tar.gz"
if [ -d "$UPLOADS_SRC" ] && [ -n "$(ls -A "$UPLOADS_SRC" 2>/dev/null)" ]; then
  echo "[2/4] tar uploads -> $UPL_FILE"
  tar -czf "$UPL_FILE" -C "$(dirname "$UPLOADS_SRC")" "$(basename "$UPLOADS_SRC")"
  UPL_SIZE=$(stat -c %s "$UPL_FILE")
  echo "      uploads tar: $UPL_SIZE bytes"
else
  echo "[2/4] uploads dir empty/missing — skipping tar"
  UPL_SIZE=0
fi

# -- 3. Per-tenant CSV bundles (for accountant audit)
echo "[3/4] per-tenant CSV exports"
TENANT_LIST=$(docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
  -t -A -c "SELECT id || '|' || code FROM organizations ORDER BY code;")

# Tables that have organization_id directly (verified via information_schema)
DIRECT_TABLES="customers customer_receipts customer_advance_movements expense_accounts expense_entries pso_topups cash_ledger_entries cash_reconciliations purchase_orders suppliers monthly_inventory_gain_loss qb_sync_log backdated_meter_readings"

while IFS='|' read -r org_id org_code; do
  [ -z "$org_id" ] && continue
  TENANT_DIR="$BACKUP_ROOT/tenants/${org_code}/${TS}"
  mkdir -p "$TENANT_DIR"
  echo "      org=$org_code id=$org_id -> $TENANT_DIR"

  for tbl in $DIRECT_TABLES; do
    docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
      -c "\copy (SELECT * FROM ${tbl} WHERE organization_id = '${org_id}') TO STDOUT WITH CSV HEADER" \
      > "$TENANT_DIR/${tbl}.csv" 2>/dev/null || echo "        WARN: ${tbl} export failed"
  done

  # JOIN-based exports for tables linked via branches
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
    -c "\copy (SELECT s.* FROM sales s JOIN branches b ON s.branch_id=b.id WHERE b.organization_id = '${org_id}') TO STDOUT WITH CSV HEADER" \
    > "$TENANT_DIR/sales.csv" 2>/dev/null || echo "        WARN: sales export failed"
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
    -c "\copy (SELECT m.* FROM meter_readings m JOIN nozzles n ON m.nozzle_id=n.id JOIN dispensing_units d ON n.dispensing_unit_id=d.id JOIN branches b ON d.branch_id=b.id WHERE b.organization_id = '${org_id}') TO STDOUT WITH CSV HEADER" \
    > "$TENANT_DIR/meter_readings.csv" 2>/dev/null || echo "        WARN: meter_readings export failed"
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
    -c "\copy (SELECT be.* FROM backdated_entries be JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '${org_id}') TO STDOUT WITH CSV HEADER" \
    > "$TENANT_DIR/backdated_entries.csv" 2>/dev/null || echo "        WARN: backdated_entries export failed"
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production \
    -c "\copy (SELECT bt.* FROM backdated_transactions bt JOIN backdated_entries be ON bt.backdated_entry_id=be.id JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '${org_id}') TO STDOUT WITH CSV HEADER" \
    > "$TENANT_DIR/backdated_transactions.csv" 2>/dev/null || echo "        WARN: backdated_transactions export failed"

  # Zip the tenant bundle
  (cd "$BACKUP_ROOT/tenants/${org_code}" && tar -czf "${TS}.tar.gz" "${TS}" && rm -rf "${TS}")
  TENANT_SIZE=$(stat -c %s "$BACKUP_ROOT/tenants/${org_code}/${TS}.tar.gz")
  echo "        bundle: $TENANT_SIZE bytes"
done <<< "$TENANT_LIST"

# -- 4. Rotation: keep 7 daily + 4 weekly + 6 monthly
# Keep all from last 7 days; from last 28 days keep one per week; from last 180 days keep one per month
echo "[4/4] rotation"
rotate_dir() {
  local dir="$1"
  local pattern="$2"
  cd "$dir" || return 0
  # Files older than 7 days
  find . -maxdepth 1 -name "$pattern" -mtime +7 | while read -r f; do
    fname=$(basename "$f")
    # Extract YYYY-MM-DD prefix (first 10 chars)
    fdate="${fname:0:10}"
    # Keep if it's the 1st of the month (monthly) or a Sunday (weekly)
    if [[ "$fdate" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      day=$(date -d "$fdate" +%u 2>/dev/null || echo 0)  # 7=Sunday
      dom=$(date -d "$fdate" +%d 2>/dev/null || echo 0)
      age_days=$(( ( $(date +%s) - $(date -d "$fdate" +%s) ) / 86400 ))
      if [ "$age_days" -gt 180 ]; then
        echo "      delete (>6mo): $fname"; rm -f "$f"
      elif [ "$age_days" -gt 28 ] && [ "$dom" != "01" ]; then
        echo "      delete (>4w, not month-1st): $fname"; rm -f "$f"
      elif [ "$age_days" -gt 7 ] && [ "$day" != "7" ] && [ "$dom" != "01" ]; then
        echo "      delete (>7d, not Sun, not month-1st): $fname"; rm -f "$f"
      fi
    fi
  done
}
rotate_dir "$BACKUP_ROOT/db" "*.dump"
rotate_dir "$BACKUP_ROOT/uploads" "*.tar.gz"
for org_dir in "$BACKUP_ROOT"/tenants/*/; do
  [ -d "$org_dir" ] && rotate_dir "$org_dir" "*.tar.gz"
done

# -- success status
TOTAL_SIZE=$(du -sb "$BACKUP_ROOT" | cut -f1)
cat > "$STATUS_FILE" <<JSON
{
  "status": "ok",
  "ts": "$(date -Iseconds)",
  "ts_date": "$TS",
  "host": "$(hostname)",
  "db_dump_bytes": $DB_SIZE,
  "uploads_bytes": $UPL_SIZE,
  "backup_root_bytes": $TOTAL_SIZE
}
JSON

echo "[$(date -Iseconds)] backup-nightly.sh OK"
