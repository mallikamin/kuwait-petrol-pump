#!/usr/bin/env bash
# Edge-side pull job for Kuwait POS backups.
# Run by cron multiple times during the night (idempotent, retries built in).
# Sends EMAIL ON SUCCESS (once per day) AND ON FAILURE.
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
  local subject=$1
  local body=$2
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
  else
    attempts=0; pull_ok_today=false; success_emailed=false; alerted_pull=false; alerted_backup=false
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
  "last_run": "$TS"
}
JSON
}

read_state

# Skip if today's pull complete AND success email sent
if [ "$pull_ok_today" = "true" ] && [ "$success_emailed" = "true" ]; then
  echo "[$TS] SKIP: today complete (pull OK, email sent)" >> "$LOG_FILE"
  exit 0
fi

attempts=$((attempts + 1))
echo "[$TS] attempt #$attempts: rsync $DROPLET:$REMOTE_DIR -> $LOCAL_DIR" >> "$LOG_FILE"

rsync_err=$(rsync -az --delete-after \
  -e "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20" \
  "$DROPLET:$REMOTE_DIR" "$LOCAL_DIR/" 2>&1)
rsync_rc=$?

if [ $rsync_rc -ne 0 ]; then
  echo "[$TS] rsync FAILED rc=$rsync_rc: $rsync_err" >> "$LOG_FILE"
  pull_ok_today=false
  if [ "$attempts" -ge 3 ] && [ "$alerted_pull" != "true" ]; then
    send_email "PULL FAILING — droplet unreachable" \
      "Tried $attempts times today to rsync from droplet ($DROPLET).
Last rsync error:
$rsync_err

Possible causes:
  - Droplet down or rebooting
  - Network problem
  - SSH key broken
  - Droplet ran out of disk space

Latest known backup: $(jq -r '.ts_date // "none"' $LOCAL_DIR/.last-run.json 2>/dev/null)"
    alerted_pull=true
  fi
  write_state
  exit $rsync_rc
fi

echo "[$TS] rsync OK" >> "$LOG_FILE"
pull_ok_today=true

# Read backup + verify status
if [ ! -f "$LOCAL_DIR/.last-run.json" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "BACKUP STATUS UNKNOWN — no .last-run.json" \
      "Pull succeeded but no .last-run.json found on droplet.
Either the backup script never ran today, or droplet's backup dir is empty.
Check: ssh root@64.226.65.80 'ls -la /root/kuwait-pos/backups/'"
    alerted_backup=true
  fi
  write_state
  exit 1
fi

BACKUP_STATUS=$(jq -r '.status // "missing"' "$LOCAL_DIR/.last-run.json")
BACKUP_DATE=$(jq -r '.ts_date // ""' "$LOCAL_DIR/.last-run.json")
BACKUP_TS=$(jq -r '.ts // ""' "$LOCAL_DIR/.last-run.json")
DB_BYTES=$(jq -r '.db_dump_bytes // 0' "$LOCAL_DIR/.last-run.json")
UPL_BYTES=$(jq -r '.uploads_bytes // 0' "$LOCAL_DIR/.last-run.json")
TOTAL_BYTES=$(jq -r '.backup_root_bytes // 0' "$LOCAL_DIR/.last-run.json")

VERIFY_STATUS="unknown"
VERIFY_DETAIL=""
if [ -f "$LOCAL_DIR/.verify-comprehensive.json" ]; then
  VERIFY_STATUS=$(jq -r '.status // "unknown"' "$LOCAL_DIR/.verify-comprehensive.json")
  VERIFY_DETAIL=$(cat "$LOCAL_DIR/.verify-comprehensive.json")
fi

backup_epoch=$(date -d "$BACKUP_TS" +%s 2>/dev/null || echo 0)
age_hours=$(( ( $(date +%s) - backup_epoch ) / 3600 ))

# Failure conditions
if [ "$BACKUP_STATUS" = "fail" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "BACKUP FAILED on droplet" \
      "$(cat $LOCAL_DIR/.last-run.json)

Recent log tail from droplet:
$(tail -30 $LOCAL_DIR/.last-run.log 2>/dev/null)"
    alerted_backup=true
  fi
elif [ "$age_hours" -gt 26 ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "BACKUP STALE — no fresh run in ${age_hours}h" \
      "Last backup was $age_hours hours ago (date: $BACKUP_DATE).
Cron may not be running on the droplet, or the backup script is failing silently.

Latest .last-run.json:
$(cat $LOCAL_DIR/.last-run.json)"
    alerted_backup=true
  fi
elif [ "$VERIFY_STATUS" = "fail" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_email "VERIFY FAILED — restore-test detected corruption" \
      "Daily backup completed but the comprehensive verification FAILED.

$VERIFY_DETAIL

Recent verify log:
$(tail -30 $LOCAL_DIR/.verify-comprehensive.log 2>/dev/null)"
    alerted_backup=true
  fi
elif [ "$success_emailed" != "true" ]; then
  # Send success email — backup OK, verify OK, fresh
  TABLES_OK=$(echo "$VERIFY_DETAIL" | jq -r '.tables_ok // 0')
  CHK_PASS=$(echo "$VERIFY_DETAIL" | jq -r '.checksums_pass // 0')
  DB_HUMAN=$(numfmt --to=iec-i --suffix=B "$DB_BYTES" 2>/dev/null || echo "${DB_BYTES}B")
  UPL_HUMAN=$(numfmt --to=iec-i --suffix=B "$UPL_BYTES" 2>/dev/null || echo "${UPL_BYTES}B")
  TOTAL_HUMAN=$(numfmt --to=iec-i --suffix=B "$TOTAL_BYTES" 2>/dev/null || echo "${TOTAL_BYTES}B")

  # Per-tenant bundle sizes
  TENANT_LINES=$(for d in $LOCAL_DIR/tenants/*/; do
    org=$(basename "$d")
    latest=$(ls -t "$d"*.tar.gz 2>/dev/null | head -1)
    [ -z "$latest" ] && continue
    sz=$(stat -c %s "$latest")
    sz_h=$(numfmt --to=iec-i --suffix=B "$sz" 2>/dev/null || echo "${sz}B")
    printf "  %-10s %s (%s)\n" "$org" "$(basename "$latest")" "$sz_h"
  done)

  send_email "Backup OK — $BACKUP_DATE ($DB_HUMAN db + $UPL_HUMAN uploads)" \
    "Daily backup completed and verified successfully.

Backup date: $BACKUP_DATE
DB dump: $DB_HUMAN
Uploads tar: $UPL_HUMAN
Total backup_root: $TOTAL_HUMAN
Backup age: ${age_hours}h

Comprehensive verification: PASS
  Tables checked: $TABLES_OK / 51
  Critical checksums: $CHK_PASS / 6 pass

Per-tenant bundles (off-site copies on $(hostname)):
$TENANT_LINES

Off-site location: /srv/kuwait-pos-backups/ on $(hostname)
Status: $VERIFY_DETAIL"
  success_emailed=true
fi

write_state
exit 0
