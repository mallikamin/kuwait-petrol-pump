#!/bin/bash
# Cron wrapper for daily QB sync health check.
# Installed via host crontab; runs the compiled health-check script
# inside the kuwaitpos-backend container.
#
# Recommended crontab entry (server):
#   0 6 * * * /opt/kuwaitpos/scripts/cron-qb-health.sh >> /var/log/kuwaitpos-qb-health.log 2>&1
#
# Optional alerting: set QB_ALERT_WEBHOOK_URL in the backend container's
# .env to a Slack/Discord-compatible incoming webhook, and the script
# will post a one-line summary on failure.
#
# Exit codes from this wrapper:
#   0  healthy
#   1  unhealthy (issues detected)
#   2  crashed (unexpected error)

set -uo pipefail

CONTAINER="${KUWAITPOS_BACKEND_CONTAINER:-kuwaitpos-backend}"
SCRIPT_PATH="/app/apps/backend/dist/scripts/qb-health-check.js"

ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "[${ts}] qb-health-check starting in container ${CONTAINER}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "[${ts}] ERROR: container ${CONTAINER} not running"
  exit 2
fi

# Run inside the container; pass through any args (e.g. --skip-coa)
docker exec -w /app/apps/backend "${CONTAINER}" node "${SCRIPT_PATH}" "$@"
rc=$?

ts2="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
case ${rc} in
  0) echo "[${ts2}] qb-health-check OK" ;;
  1) echo "[${ts2}] qb-health-check UNHEALTHY (rc=1)" ;;
  *) echo "[${ts2}] qb-health-check CRASHED (rc=${rc})" ;;
esac

exit ${rc}
