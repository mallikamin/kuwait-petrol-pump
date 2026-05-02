#!/usr/bin/env bash
# Cross-day regression detection for Kuwait POS.
# Snapshots row counts daily; alerts if any table shrinks unexpectedly.
# A drop is "expected" only if explicitly acknowledged in regression-acks.json.
set -uo pipefail

BACKUP_ROOT=/root/kuwait-pos/backups
PG_CONTAINER=kuwaitpos-postgres
COUNTS_DIR=$BACKUP_ROOT/row-counts
ACKS_FILE=$BACKUP_ROOT/regression-acks.json
STATUS_FILE=$BACKUP_ROOT/.regression-check.json
LOG_FILE=$BACKUP_ROOT/.regression-check.log
TS=$(date -Iseconds)
TODAY=$(date +%F)

mkdir -p "$COUNTS_DIR"
echo "[$TS] regression-check START" > "$LOG_FILE"

# Init acks file if missing
if [ ! -f "$ACKS_FILE" ]; then
  echo "{}" > "$ACKS_FILE"
  echo "[$TS] initialized empty acks file at $ACKS_FILE" | tee -a "$LOG_FILE"
fi

qc() { docker exec "$PG_CONTAINER" psql -U petrolpump_prod -d petrolpump_production -t -A -c "$1" 2>/dev/null || echo "ERR"; }

# Snapshot today's counts
TODAY_FILE="$COUNTS_DIR/$TODAY.json"
TABLES=$(qc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")
echo "[$TS] snapshotting counts for today..." | tee -a "$LOG_FILE"

{
  echo "{"
  first=true
  for tbl in $TABLES; do
    n=$(qc "SELECT count(*) FROM \"$tbl\";")
    if [ "$first" = "true" ]; then first=false; else echo ","; fi
    printf '  "%s": %s' "$tbl" "$n"
  done
  echo
  echo "}"
} > "$TODAY_FILE"
echo "[$TS] snapshot saved: $TODAY_FILE" | tee -a "$LOG_FILE"

# Find yesterday's snapshot (or most recent prior)
PRIOR_FILE=$(ls -1 "$COUNTS_DIR"/*.json 2>/dev/null | grep -v "/$TODAY.json$" | sort | tail -1)

if [ -z "$PRIOR_FILE" ]; then
  echo "[$TS] no prior snapshot — baseline established, nothing to compare" | tee -a "$LOG_FILE"
  cat > "$STATUS_FILE" <<JSON
{"status":"baseline","ts":"$TS","ts_date":"$TODAY","note":"first snapshot — no comparison possible"}
JSON
  # Rotate counts: keep last 90 days
  find "$COUNTS_DIR" -name "*.json" -mtime +90 -delete 2>/dev/null
  exit 0
fi

PRIOR_DATE=$(basename "$PRIOR_FILE" .json)
echo "[$TS] comparing $TODAY vs $PRIOR_DATE" | tee -a "$LOG_FILE"

# Compare per-table; build regression list
REGRESSIONS=()
ACKED=()
GROWTH=()
SAME=()

for tbl in $TABLES; do
  today_n=$(jq -r --arg t "$tbl" '.[$t] // 0' "$TODAY_FILE")
  prior_n=$(jq -r --arg t "$tbl" '.[$t] // 0' "$PRIOR_FILE")

  # Skip if either is non-numeric
  case "$today_n" in (*[!0-9]*) continue ;; esac
  case "$prior_n" in (*[!0-9]*) continue ;; esac

  if [ "$today_n" -lt "$prior_n" ]; then
    drop=$((prior_n - today_n))
    # Check ack file for this table+date
    ack=$(jq -r --arg d "$TODAY" --arg t "$tbl" '.[$d][$t] // ""' "$ACKS_FILE" 2>/dev/null)
    if [ -n "$ack" ]; then
      ACKED+=("$tbl: $prior_n → $today_n (drop $drop) — ACKED: $ack")
    else
      REGRESSIONS+=("$tbl: $prior_n → $today_n (drop $drop)")
    fi
  elif [ "$today_n" -gt "$prior_n" ]; then
    GROWTH+=("$tbl: $prior_n → $today_n (+$((today_n - prior_n)))")
  else
    SAME+=("$tbl: $today_n")
  fi
done

# Log full report
{
  echo "[$TS] === REGRESSION REPORT ==="
  echo "Comparing today ($TODAY) vs prior snapshot ($PRIOR_DATE)"
  echo
  echo "UNACKED REGRESSIONS (${#REGRESSIONS[@]}):"
  for r in "${REGRESSIONS[@]}"; do echo "  ✗ $r"; done
  echo
  echo "ACKED REGRESSIONS (${#ACKED[@]}):"
  for r in "${ACKED[@]}"; do echo "  ✓ $r"; done
  echo
  echo "GROWTH (${#GROWTH[@]}):"
  for r in "${GROWTH[@]}"; do echo "  + $r"; done
  echo
  echo "UNCHANGED (${#SAME[@]}):"
  for r in "${SAME[@]}"; do echo "  · $r"; done
} | tee -a "$LOG_FILE"

# Build status JSON
REGRESSIONS_JSON="[]"
if [ ${#REGRESSIONS[@]} -gt 0 ]; then
  REGRESSIONS_JSON=$(printf '%s\n' "${REGRESSIONS[@]}" | jq -R . | jq -s .)
fi
ACKED_JSON="[]"
if [ ${#ACKED[@]} -gt 0 ]; then
  ACKED_JSON=$(printf '%s\n' "${ACKED[@]}" | jq -R . | jq -s .)
fi

if [ ${#REGRESSIONS[@]} -gt 0 ]; then
  cat > "$STATUS_FILE" <<JSON
{
  "status": "regression",
  "ts": "$TS",
  "ts_date": "$TODAY",
  "compared_against": "$PRIOR_DATE",
  "unacked_regressions_count": ${#REGRESSIONS[@]},
  "acked_regressions_count": ${#ACKED[@]},
  "growth_count": ${#GROWTH[@]},
  "unchanged_count": ${#SAME[@]},
  "unacked_regressions": $REGRESSIONS_JSON,
  "acked_regressions": $ACKED_JSON
}
JSON
  echo "[$TS] STATUS: REGRESSION (${#REGRESSIONS[@]} unacked, ${#ACKED[@]} acked)" | tee -a "$LOG_FILE"
  exit 1
else
  cat > "$STATUS_FILE" <<JSON
{
  "status": "ok",
  "ts": "$TS",
  "ts_date": "$TODAY",
  "compared_against": "$PRIOR_DATE",
  "acked_regressions_count": ${#ACKED[@]},
  "growth_count": ${#GROWTH[@]},
  "unchanged_count": ${#SAME[@]},
  "acked_regressions": $ACKED_JSON
}
JSON
  echo "[$TS] STATUS: OK (no unacked regressions)" | tee -a "$LOG_FILE"
fi

# Rotation: keep last 90 daily snapshots
find "$COUNTS_DIR" -name "*.json" -mtime +90 -delete 2>/dev/null
exit 0
