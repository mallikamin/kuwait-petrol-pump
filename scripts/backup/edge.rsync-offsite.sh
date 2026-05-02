#!/usr/bin/env bash
# Edge-side pull job for Kuwait POS backups.
# Pulls droplet's backups, then evaluates: backup status, verify status, REGRESSION status.
# Email on success (1/day) AND on each failure type (1/day per type).
set -uo pipefail

DROPLET=root@64.226.65.80
REMOTE_DIR=/root/kuwait-pos/backups/
LOCAL_DIR=/srv/kuwait-pos-backups
STATE_FILE=$LOCAL_DIR/.pull-state.json
LOG_FILE=$LOCAL_DIR/.pull.log
TS=$(date -Iseconds)
TODAY=$(date +%F)

mkdir -p "$LOCAL_DIR"
echo "[$TS] rsync-offsite.sh START" >> "$LOG_FILE"

send_email() {
  local subject=$1; local body=$2
  printf "Subject: [KuwaitPOS-Backup] %s\nFrom: mallikamiin@gmail.com\nTo: mallikamiin@gmail.com, amin@sitaratech.info\n\n%s\n\n--\nSent: %s\nFrom host: %s\n" \
    "$subject" "$body" "$TS" "$(hostname)" \
    | msmtp -a default mallikamiin@gmail.com amin@sitaratech.info
  echo "[$TS] EMAIL SENT: $subject" >> "$LOG_FILE"
}

read_state() {
  if [ -f "$STATE_FILE" ] && [ "$(jq -r '.today // ""' "$STATE_FILE" 2>/dev/null)" = "$TODAY" ]; then
    attempts=$(jq -r '.attempts // 0' "$STATE_FILE")
    pull_ok_today=$(jq -r '.pull_ok // false' "$STATE_FILE")
    success_emailed=$(jq -r '.success_emailed // false' "$STATE_FILE")
    alerted_pull=$(jq -r '.alerted_pull // false' "$STATE_FILE")
    alerted_backup=$(jq -r '.alerted_backup // false' "$STATE_FILE")
    alerted_verify=$(jq -r '.alerted_verify // false' "$STATE_FILE")
    alerted_regression=$(jq -r '.alerted_regression // false' "$STATE_FILE")
  else
    attempts=0; pull_ok_today=false; success_emailed=false
    alerted_pull=false; alerted_backup=false; alerted_verify=false; alerted_regression=false
  fi
}

write_state() {
  cat > "$STATE_FILE" <<JSON
{
  "today": "$TODAY",
  "attempts": $attempts,
  "pull_ok": $pull_ok_today,
  "success_emailed": $success_emailed,
  "alerted_pull": $alerted_pull,
  "alerted_backup": $alerted_backup,
  "alerted_verify": $alerted_verify,
  "alerted_regression": $alerted_regression,
  "last_run": "$TS"
}
JSON
}

read_state

if [ "$pull_ok_today" = "true" ] && [ "$success_emailed" = "true" ]; then
  REG_STATUS=$(jq -r '.status // "unknown"' "$LOCAL_DIR/.regression-check.json" 2>/dev/null)
  if [ "$REG_STATUS" != "regression" ] || [ "$alerted_regression" = "true" ]; then
    echo "[$TS] SKIP: today complete" >> "$LOG_FILE"; exit 0
  fi
fi

attempts=$((attempts + 1))
echo "[$TS] attempt #$attempts" >> "$LOG_FILE"

rsync_err=$(rsync -az --delete-after \
  -e "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20" \
  "$DROPLET:$REMOTE_DIR" "$LOCAL_DIR/" 2>&1)
rsync_rc=$?

if [ $rsync_rc -ne 0 ]; then
  echo "[$TS] rsync FAILED rc=$rsync_rc" >> "$LOG_FILE"
  pull_ok_today=false
  if [ "$attempts" -ge 3 ] && [ "$alerted_pull" != "true" ]; then
    send_email "PULL FAILING - droplet unreachable" "Tried $attempts times today.
Error: $rsync_err
Latest known backup: $(jq -r '.ts_date // "none"' $LOCAL_DIR/.last-run.json 2>/dev/null)"
    alerted_pull=true
  fi
  write_state; exit $rsync_rc
fi

echo "[$TS] rsync OK" >> "$LOG_FILE"
pull_ok_today=true

BACKUP_STATUS=$(jq -r '.status // "missing"' "$LOCAL_DIR/.last-run.json" 2>/dev/null)
BACKUP_DATE=$(jq -r '.ts_date // ""' "$LOCAL_DIR/.last-run.json" 2>/dev/null)
BACKUP_TS=$(jq -r '.ts // ""' "$LOCAL_DIR/.last-run.json" 2>/dev/null)
DB_BYTES=$(jq -r '.db_dump_bytes // 0' "$LOCAL_DIR/.last-run.json" 2>/dev/null)
UPL_BYTES=$(jq -r '.uploads_bytes // 0' "$LOCAL_DIR/.last-run.json" 2>/dev/null)

VERIFY_STATUS="unknown"; VERIFY_DETAIL=""
if [ -f "$LOCAL_DIR/.verify-comprehensive.json" ]; then
  VERIFY_STATUS=$(jq -r '.status // "unknown"' "$LOCAL_DIR/.verify-comprehensive.json")
  VERIFY_DETAIL=$(cat "$LOCAL_DIR/.verify-comprehensive.json")
fi

REG_STATUS="unknown"; REG_DETAIL=""
if [ -f "$LOCAL_DIR/.regression-check.json" ]; then
  REG_STATUS=$(jq -r '.status // "unknown"' "$LOCAL_DIR/.regression-check.json")
  REG_DETAIL=$(cat "$LOCAL_DIR/.regression-check.json")
fi

backup_epoch=$(date -d "$BACKUP_TS" +%s 2>/dev/null || echo 0)
age_hours=$(( ( $(date +%s) - backup_epoch ) / 3600 ))

if [ "$BACKUP_STATUS" = "fail" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "BACKUP FAILED on droplet" "$(cat $LOCAL_DIR/.last-run.json)

Recent log tail:
$(tail -30 $LOCAL_DIR/.last-run.log 2>/dev/null)"
    alerted_backup=true
  fi
elif [ "$age_hours" -gt 26 ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "BACKUP STALE - no fresh run in ${age_hours}h" "Last backup: $BACKUP_DATE (${age_hours}h ago).
Cron may not be running on droplet.
$(cat $LOCAL_DIR/.last-run.json)"
    alerted_backup=true
  fi
elif [ "$VERIFY_STATUS" = "fail" ]; then
  if [ "$alerted_verify" != "true" ]; then
    send_email "VERIFY FAILED - restore-test detected corruption" "$VERIFY_DETAIL

Recent verify log:
$(tail -30 $LOCAL_DIR/.verify-comprehensive.log 2>/dev/null)"
    alerted_verify=true
  fi
elif [ "$REG_STATUS" = "regression" ]; then
  if [ "$alerted_regression" != "true" ]; then
    UNACKED_LIST=$(echo "$REG_DETAIL" | jq -r '.unacked_regressions[]?' | sed 's/^/  - /')
    ACKED_LIST=$(echo "$REG_DETAIL" | jq -r '.acked_regressions[]?' | sed 's/^/  + /')
    UNACKED_N=$(echo "$REG_DETAIL" | jq -r '.unacked_regressions_count // 0')
    PRIOR=$(echo "$REG_DETAIL" | jq -r '.compared_against // "?"')
    send_email "REGRESSION DETECTED - $UNACKED_N table(s) shrunk without ack" "Comparing today ($TODAY) vs prior snapshot ($PRIOR).

Tables that LOST ROWS without an acknowledged reason:
$UNACKED_LIST

ACTION REQUIRED - choose ONE per table:
  (a) DATA LOSS BUG: investigate, restore from yesterday's backup
  (b) INTENTIONAL: edit ack file to record reason:
        ssh root@64.226.65.80
        nano /root/kuwait-pos/backups/regression-acks.json
      Format: {\"$TODAY\": {\"<table_name>\": \"reason (who, why)\"}}

Acked regressions (already explained):
${ACKED_LIST:-  (none)}

Full status:
$REG_DETAIL"
    alerted_regression=true
  fi
elif [ "$success_emailed" != "true" ]; then
  TABLES_OK=$(echo "$VERIFY_DETAIL" | jq -r '.tables_ok // 0')
  CHK_PASS=$(echo "$VERIFY_DETAIL" | jq -r '.checksums_pass // 0')
  REG_NOTE="not yet baselined"
  if [ "$REG_STATUS" = "ok" ]; then
    GROWTH=$(echo "$REG_DETAIL" | jq -r '.growth_count // 0')
    ACKED=$(echo "$REG_DETAIL" | jq -r '.acked_regressions_count // 0')
    REG_NOTE="OK ($GROWTH tables grew, $ACKED acked drops, no unacked regressions)"
  elif [ "$REG_STATUS" = "baseline" ]; then
    REG_NOTE="baseline established (first snapshot today)"
  fi
  DB_HUMAN=$(numfmt --to=iec-i --suffix=B "$DB_BYTES" 2>/dev/null || echo "${DB_BYTES}B")
  UPL_HUMAN=$(numfmt --to=iec-i --suffix=B "$UPL_BYTES" 2>/dev/null || echo "${UPL_BYTES}B")
  TENANT_LINES=$(for d in $LOCAL_DIR/tenants/*/; do
    org=$(basename "$d")
    latest=$(ls -t "$d"*.tar.gz 2>/dev/null | head -1)
    [ -z "$latest" ] && continue
    sz=$(stat -c %s "$latest"); sz_h=$(numfmt --to=iec-i --suffix=B "$sz" 2>/dev/null)
    printf "  %-10s %s (%s)\n" "$org" "$(basename "$latest")" "$sz_h"
  done)
  send_email "Backup OK - $BACKUP_DATE ($DB_HUMAN db + $UPL_HUMAN uploads)" "Daily backup completed and verified successfully.

Backup date: $BACKUP_DATE
DB dump: $DB_HUMAN
Uploads tar: $UPL_HUMAN
Backup age: ${age_hours}h

Verification: PASS ($TABLES_OK / 51 tables, $CHK_PASS / 6 checksums)
Regression check: $REG_NOTE

Per-tenant bundles (off-site copies on $(hostname)):
$TENANT_LINES

Off-site location: /srv/kuwait-pos-backups/ on $(hostname)"
  success_emailed=true
fi

write_state
exit 0
