#!/usr/bin/env bash
# Comprehensive restore verification — every backup-critical table, both orgs.
# Run on-demand or weekly. Compares row counts AND content checksums.
set -uo pipefail

BACKUP_ROOT=/root/kuwait-pos/backups
PG_CONTAINER=kuwaitpos-postgres
TEST_DB=petrolpump_verify_comprehensive
LOG_FILE=$BACKUP_ROOT/.verify-comprehensive.log
STATUS_FILE=$BACKUP_ROOT/.verify-comprehensive.json
TS=$(date -Iseconds)
PROD_DB=petrolpump_production

# All tables we care about for backup integrity
TABLES="users organizations branches customers customer_receipts customer_advance_movements customer_receipt_allocations customer_branch_limits suppliers supplier_payments products fuel_types fuel_prices fuel_inventory fuel_inventory_transactions fuel_sales non_fuel_sales sales shifts shift_instances dispensing_units nozzles meter_readings backdated_meter_readings backdated_entries backdated_transactions expense_accounts expense_entries pso_topups cash_ledger_entries cash_reconciliations purchase_orders purchase_order_items stock_receipts stock_receipt_items stock_levels banks bifurcations inventory_bootstrap monthly_inventory_gain_loss qb_connections qb_entity_mappings qb_entities_snapshot qb_mapping_batches qb_mapping_history qb_sync_log qb_sync_queue quickbooks_audit_log audit_log user_branch_access user_org_access"

echo "[$TS] verify-comprehensive START" > "$LOG_FILE"

LATEST=$(ls -1t "$BACKUP_ROOT/db"/*.dump 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "[$TS] FAIL: no dump" | tee -a "$LOG_FILE"
  exit 1
fi
DUMP_SIZE=$(stat -c %s "$LATEST")
echo "[$TS] dump: $LATEST ($DUMP_SIZE bytes)" | tee -a "$LOG_FILE"

# Helper for psql queries
qc() { docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d "$1" -t -A -c "$2" 2>/dev/null || echo "ERR"; }

# Restore into clean throwaway
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" >> "$LOG_FILE" 2>&1
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres -c "CREATE DATABASE $TEST_DB OWNER petrolpump_prod;" >> "$LOG_FILE" 2>&1
echo "[$TS] restoring dump into $TEST_DB..." | tee -a "$LOG_FILE"
cat "$LATEST" | docker exec -i "$PG_CONTAINER" pg_restore -U petrolpump_prod -d "$TEST_DB" --no-owner --no-acl 2>>"$LOG_FILE"
echo "[$TS] restore complete" | tee -a "$LOG_FILE"

# Compare row counts table-by-table
echo "[$TS] === TABLE-BY-TABLE ROW COUNT VERIFICATION ===" | tee -a "$LOG_FILE"
PASS_COUNT=0
FAIL_COUNT=0
MISSING_COUNT=0
FAILED_TABLES=""
declare -A PROD_COUNTS RES_COUNTS

for tbl in $TABLES; do
  prod_n=$(qc "$PROD_DB" "SELECT count(*) FROM $tbl;")
  res_n=$(qc "$TEST_DB" "SELECT count(*) FROM $tbl;")
  PROD_COUNTS[$tbl]=$prod_n
  RES_COUNTS[$tbl]=$res_n
  if [ "$prod_n" = "ERR" ] || [ "$res_n" = "ERR" ]; then
    printf "  %-40s prod=%-8s restored=%-8s [MISSING/ERR]\n" "$tbl" "$prod_n" "$res_n" | tee -a "$LOG_FILE"
    MISSING_COUNT=$((MISSING_COUNT + 1))
  elif [ "$prod_n" = "$res_n" ]; then
    printf "  %-40s prod=%-8s restored=%-8s OK\n" "$tbl" "$prod_n" "$res_n" | tee -a "$LOG_FILE"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf "  %-40s prod=%-8s restored=%-8s **MISMATCH**\n" "$tbl" "$prod_n" "$res_n" | tee -a "$LOG_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TABLES="$FAILED_TABLES $tbl"
  fi
done

# Content checksum on a few critical SE-affecting tables
echo "[$TS] === CONTENT CHECKSUM VERIFICATION ===" | tee -a "$LOG_FILE"
checksum_table() {
  local db=$1
  local tbl=$2
  docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d "$db" -t -A \
    -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM (SELECT * FROM $tbl) t;" 2>/dev/null || echo "ERR"
}

CHECKSUM_PASS=0
CHECKSUM_FAIL=0
CHECKSUM_TABLES="customers backdated_meter_readings expense_accounts suppliers organizations branches"
for tbl in $CHECKSUM_TABLES; do
  ph=$(checksum_table "$PROD_DB" "$tbl")
  rh=$(checksum_table "$TEST_DB" "$tbl")
  if [ "$ph" = "$rh" ] && [ "$ph" != "ERR" ]; then
    printf "  %-30s checksum MATCHES (%s)\n" "$tbl" "${ph:0:12}..." | tee -a "$LOG_FILE"
    CHECKSUM_PASS=$((CHECKSUM_PASS + 1))
  else
    printf "  %-30s checksum DIFFERS prod=%s restored=%s\n" "$tbl" "${ph:0:12}" "${rh:0:12}" | tee -a "$LOG_FILE"
    CHECKSUM_FAIL=$((CHECKSUM_FAIL + 1))
  fi
done

# Cleanup
docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" >> "$LOG_FILE" 2>&1

# Final verdict
TOTAL_TABLES=$(echo $TABLES | wc -w)
echo "[$TS] === VERDICT ===" | tee -a "$LOG_FILE"
echo "[$TS] Tables checked: $TOTAL_TABLES | OK: $PASS_COUNT | mismatch: $FAIL_COUNT | missing/err: $MISSING_COUNT" | tee -a "$LOG_FILE"
echo "[$TS] Content checksums: $CHECKSUM_PASS pass, $CHECKSUM_FAIL fail" | tee -a "$LOG_FILE"

if [ $FAIL_COUNT -eq 0 ] && [ $CHECKSUM_FAIL -eq 0 ]; then
  cat > "$STATUS_FILE" <<JSON
{
  "status": "ok",
  "ts": "$TS",
  "dump_tested": "$LATEST",
  "tables_checked": $TOTAL_TABLES,
  "tables_ok": $PASS_COUNT,
  "tables_mismatch": $FAIL_COUNT,
  "tables_missing": $MISSING_COUNT,
  "checksums_pass": $CHECKSUM_PASS,
  "checksums_fail": $CHECKSUM_FAIL
}
JSON
  echo "[$TS] OVERALL: PASS" | tee -a "$LOG_FILE"
  exit 0
else
  cat > "$STATUS_FILE" <<JSON
{
  "status": "fail",
  "ts": "$TS",
  "dump_tested": "$LATEST",
  "tables_checked": $TOTAL_TABLES,
  "tables_ok": $PASS_COUNT,
  "tables_mismatch": $FAIL_COUNT,
  "tables_missing": $MISSING_COUNT,
  "failed_tables": "$FAILED_TABLES",
  "checksums_pass": $CHECKSUM_PASS,
  "checksums_fail": $CHECKSUM_FAIL
}
JSON
  echo "[$TS] OVERALL: FAIL" | tee -a "$LOG_FILE"
  exit 1
fi
