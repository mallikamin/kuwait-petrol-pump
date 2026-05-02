#!/usr/bin/env bash
# Edge-side pull job for Kuwait POS backups.
# Run by cron multiple times during the night (idempotent, retries built in).
# Responsibilities:
#   1. rsync droplet's backups dir to /srv/kuwait-pos-backups/
#   2. Read .last-run.json — alert if backup status=fail or stale (>26h)
#   3. Track attempts per day in state file; if 3 attempts fail, send "pull failing" email
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

send_alert() {
  local subject=$1
  local body=$2
  printf "Subject: [KuwaitPOS-Backup] %s\nFrom: mallikamiin@gmail.com\nTo: mallikamiin@gmail.com, amin@sitaratech.info\n\n%s\n\n--\nSent: %s\nFrom host: %s\n" \
    "$subject" "$body" "$TS" "$(hostname)" \
    | msmtp -a default mallikamiin@gmail.com amin@sitaratech.info
  echo "[$TS] ALERT SENT: $subject" >> "$LOG_FILE"
}

# Read state (today's attempt count + last alert sent for what)
read_state() {
  if [ -f "$STATE_FILE" ]; then
    state_today=$(jq -r ".today // \"\"" "$STATE_FILE" 2>/dev/null || echo "")
    if [ "$state_today" = "$TODAY" ]; then
      attempts=$(jq -r ".attempts // 0" "$STATE_FILE")
      pull_ok_today=$(jq -r ".pull_ok // false" "$STATE_FILE")
      alerted_pull=$(jq -r ".alerted_pull // false" "$STATE_FILE")
      alerted_backup=$(jq -r ".alerted_backup // false" "$STATE_FILE")
    else
      # New day — reset
      attempts=0; pull_ok_today=false; alerted_pull=false; alerted_backup=false
    fi
  else
    attempts=0; pull_ok_today=false; alerted_pull=false; alerted_backup=false
  fi
}

write_state() {
  cat > "$STATE_FILE" <<JSON
{
  "today": "$TODAY",
  "attempts": $attempts,
  "pull_ok": $pull_ok_today,
  "alerted_pull": $alerted_pull,
  "alerted_backup": $alerted_backup,
  "last_run": "$TS"
}
JSON
}

read_state

# Skip if today's pull already succeeded AND today's backup status was OK
if [ "$pull_ok_today" = "true" ] && [ "$alerted_backup" != "true" ]; then
  # Re-check the freshly-pulled status to see if it's still OK
  if [ -f "$LOCAL_DIR/.last-run.json" ]; then
    backup_status=$(jq -r ".status // \"missing\"" "$LOCAL_DIR/.last-run.json")
    backup_date=$(jq -r ".ts_date // \"\"" "$LOCAL_DIR/.last-run.json")
    if [ "$backup_status" = "ok" ] && [ "$backup_date" = "$TODAY" ]; then
      echo "[$TS] SKIP: today's pull already OK and backup status OK" >> "$LOG_FILE"
      exit 0
    fi
  fi
fi

attempts=$((attempts + 1))

# -- Try the pull
echo "[$TS] attempt #$attempts: rsync $DROPLET:$REMOTE_DIR -> $LOCAL_DIR" >> "$LOG_FILE"
rsync_err=$(rsync -az --delete-after \
  -e "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20" \
  "$DROPLET:$REMOTE_DIR" "$LOCAL_DIR/" 2>&1)
rsync_rc=$?

if [ $rsync_rc -ne 0 ]; then
  echo "[$TS] rsync FAILED rc=$rsync_rc: $rsync_err" >> "$LOG_FILE"
  pull_ok_today=false
  # Alert only after 3 failed attempts in one day, and only once per day
  if [ "$attempts" -ge 3 ] && [ "$alerted_pull" != "true" ]; then
    send_alert "PULL FAILING — droplet unreachable" \
      "Tried $attempts times today to rsync from droplet ($DROPLET).
Last rsync error:
$rsync_err

This may mean:
  - Droplet is down or rebooting
  - Network problem between edge and droplet
  - SSH key broken
  - Droplet ran out of disk space

Local backups on edge are NOT updated for today ($TODAY).
Latest known backup: $(jq -r '.ts_date // "none"' $LOCAL_DIR/.last-run.json 2>/dev/null)"
    alerted_pull=true
  fi
  write_state
  exit $rsync_rc
fi

# -- Pull succeeded
echo "[$TS] rsync OK" >> "$LOG_FILE"
pull_ok_today=true

# Inspect what we just pulled
if [ ! -f "$LOCAL_DIR/.last-run.json" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_alert "BACKUP STATUS UNKNOWN — no .last-run.json" \
      "Pull succeeded but no .last-run.json found on droplet.
Either the backup script never ran today, or the droplet's backup dir is empty.
Check: ssh root@64.226.65.80 'ls -la /root/kuwait-pos/backups/'"
    alerted_backup=true
  fi
  write_state
  exit 1
fi

backup_status=$(jq -r ".status // \"missing\"" "$LOCAL_DIR/.last-run.json")
backup_date=$(jq -r ".ts_date // \"\"" "$LOCAL_DIR/.last-run.json")
backup_ts=$(jq -r ".ts // \"\"" "$LOCAL_DIR/.last-run.json")

# Stale = backup_date != today AND no fresh run within 26h
backup_epoch=$(date -d "$backup_ts" +%s 2>/dev/null || echo 0)
now_epoch=$(date +%s)
age_hours=$(( (now_epoch - backup_epoch) / 3600 ))

if [ "$backup_status" = "fail" ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_alert "BACKUP FAILED on droplet" \
      "$(cat $LOCAL_DIR/.last-run.json)

Recent log tail from droplet:
$(tail -30 $LOCAL_DIR/.last-run.log 2>/dev/null)"
    alerted_backup=true
  fi
elif [ "$age_hours" -gt 26 ]; then
  if [ "$alerted_backup" != "true" ]; then
    send_alert "BACKUP STALE — no fresh run in ${age_hours}h" \
      "Last backup was $age_hours hours ago (date: $backup_date).
Cron may not be running on the droplet, or the backup script is failing silently.

Latest .last-run.json:
$(cat $LOCAL_DIR/.last-run.json)"
    alerted_backup=true
  fi
else
  echo "[$TS] backup OK (date=$backup_date, age=${age_hours}h)" >> "$LOG_FILE"
fi

write_state
exit 0
