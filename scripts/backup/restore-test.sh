#!/usr/bin/env bash
# Weekly restore verification — proves the latest pg_dump is restorable.
# Asserts SE row counts match prod across multiple critical tables (incl. backdated).
set -uo pipefail

BACKUP_ROOT=/root/kuwait-pos/backups
PG_CONTAINER=kuwaitpos-postgres
TEST_DB=petrolpump_restore_test
LOG_FILE=$BACKUP_ROOT/.restore-test.log
STATUS_FILE=$BACKUP_ROOT/.restore-test.json
SE='a877d2e1-a8a0-4969-a1cd-5639dbbdce5e'
TS=$(date -Iseconds)

echo "[$TS] restore-test.sh START" > "$LOG_FILE"

LATEST=$(ls -1t "$BACKUP_ROOT/db"/*.dump 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "[$TS] FAIL: no dump found" | tee -a "$LOG_FILE"
  cat > "$STATUS_FILE" <<JSON
{"status":"fail","ts":"$TS","error":"no dump file in $BACKUP_ROOT/db"}
JSON
  exit 1
fi
echo "[$TS] testing dump: $LATEST" | tee -a "$LOG_FILE"

# Helper: run a count query against a given DB
qc() {
  local db=$1
  local sql=$2
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d "$db" -t -A -c "$sql" 2>/dev/null || echo "ERR"
}

# SE counts on production
PROD_CUST=$(qc petrolpump_production "SELECT count(*) FROM customers WHERE organization_id = '$SE';")
PROD_BMR=$(qc petrolpump_production "SELECT count(*) FROM backdated_meter_readings WHERE organization_id = '$SE';")
PROD_BE=$(qc petrolpump_production "SELECT count(*) FROM backdated_entries be JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '$SE';")
PROD_BT=$(qc petrolpump_production "SELECT count(*) FROM backdated_transactions bt JOIN backdated_entries be ON bt.backdated_entry_id=be.id JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '$SE';")
PROD_SUP=$(qc petrolpump_production "SELECT count(*) FROM suppliers WHERE organization_id = '$SE';")
PROD_EA=$(qc petrolpump_production "SELECT count(*) FROM expense_accounts WHERE organization_id = '$SE';")
echo "[$TS] prod SE: customers=$PROD_CUST bmr=$PROD_BMR backdated_entries=$PROD_BE backdated_txns=$PROD_BT suppliers=$PROD_SUP expense_accts=$PROD_EA" | tee -a "$LOG_FILE"

# Drop + recreate test DB
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" >> "$LOG_FILE" 2>&1
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres \
  -c "CREATE DATABASE $TEST_DB OWNER petrolpump_prod;" >> "$LOG_FILE" 2>&1

# Restore the dump
echo "[$TS] restoring..." | tee -a "$LOG_FILE"
cat "$LATEST" | docker exec -i "$PG_CONTAINER" pg_restore -U petrolpump_prod -d "$TEST_DB" --no-owner --no-acl 2>>"$LOG_FILE"

# SE counts on restored DB
RES_CUST=$(qc "$TEST_DB" "SELECT count(*) FROM customers WHERE organization_id = '$SE';")
RES_BMR=$(qc "$TEST_DB" "SELECT count(*) FROM backdated_meter_readings WHERE organization_id = '$SE';")
RES_BE=$(qc "$TEST_DB" "SELECT count(*) FROM backdated_entries be JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '$SE';")
RES_BT=$(qc "$TEST_DB" "SELECT count(*) FROM backdated_transactions bt JOIN backdated_entries be ON bt.backdated_entry_id=be.id JOIN branches b ON be.branch_id=b.id WHERE b.organization_id = '$SE';")
RES_SUP=$(qc "$TEST_DB" "SELECT count(*) FROM suppliers WHERE organization_id = '$SE';")
RES_EA=$(qc "$TEST_DB" "SELECT count(*) FROM expense_accounts WHERE organization_id = '$SE';")
echo "[$TS] restored SE: customers=$RES_CUST bmr=$RES_BMR backdated_entries=$RES_BE backdated_txns=$RES_BT suppliers=$RES_SUP expense_accts=$RES_EA" | tee -a "$LOG_FILE"

# Always drop the test DB
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" >> "$LOG_FILE" 2>&1

# Compare
PASS=true
[ "$PROD_CUST" = "$RES_CUST" ] || PASS=false
[ "$PROD_BMR"  = "$RES_BMR"  ] || PASS=false
[ "$PROD_BE"   = "$RES_BE"   ] || PASS=false
[ "$PROD_BT"   = "$RES_BT"   ] || PASS=false
[ "$PROD_SUP"  = "$RES_SUP"  ] || PASS=false
[ "$PROD_EA"   = "$RES_EA"   ] || PASS=false

if [ "$PASS" = "true" ]; then
  cat > "$STATUS_FILE" <<JSON
{
  "status": "ok",
  "ts": "$TS",
  "dump_tested": "$LATEST",
  "se_counts_verified": {
    "customers": $PROD_CUST,
    "backdated_meter_readings": $PROD_BMR,
    "backdated_entries": $PROD_BE,
    "backdated_transactions": $PROD_BT,
    "suppliers": $PROD_SUP,
    "expense_accounts": $PROD_EA
  }
}
JSON
  echo "[$TS] PASS" | tee -a "$LOG_FILE"
  exit 0
else
  cat > "$STATUS_FILE" <<JSON
{
  "status": "fail",
  "ts": "$TS",
  "dump_tested": "$LATEST",
  "prod":     {"cust":$PROD_CUST,"bmr":$PROD_BMR,"be":$PROD_BE,"bt":$PROD_BT,"sup":$PROD_SUP,"ea":$PROD_EA},
  "restored": {"cust":"$RES_CUST","bmr":"$RES_BMR","be":"$RES_BE","bt":"$RES_BT","sup":"$RES_SUP","ea":"$RES_EA"}
}
JSON
  echo "[$TS] FAIL: counts diverge" | tee -a "$LOG_FILE"
  exit 1
fi
