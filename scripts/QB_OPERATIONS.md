# QuickBooks Sync — Operations Runbook

This document covers the QB sync's runtime monitoring (`qb-health-check`)
and per-org mapping seed (`qb-seed-discover`). The legacy SQL seed
(`qb-mapping-seed.sql`) is retained as a fallback but should not be the
primary path going forward — it's single-tenant and hardcodes kpc IDs.

---

## 1. Daily health check

### Purpose
Catch QB sync failures (dead-letter jobs, stuck workers, expiring
tokens, stale mappings, gain/loss rows that never made it into QB)
**before** an accountant or client notices.

### What it checks (per active QB connection)
1. `qb_sync_queue` rows in `dead_letter` status — any → alert
2. `qb_sync_queue` rows with `status='failed'` in the last 24h — any → alert
3. `qb_sync_queue` rows in `pending`/`processing` older than `--stuck-threshold-min` (default 30) — any → alert
4. `qb_connections.refresh_token_expires_at` < `--token-warn-days` (default 14) — alert
5. `qb_entity_mappings` whose `qb_id` is missing or marked `Active=false` in the live QB COA — alert (this catches "client deleted account in QB" before the next post fails)
6. `monthly_inventory_gain_loss` rows that have NO successful `CREATE_JOURNAL_ENTRY` audit-log entry — alert (catches DRY_RUN-as-completed traps)

### Local invocation
```bash
docker exec -w /app/apps/backend kuwaitpos-backend \
  node dist/scripts/qb-health-check.js

# JSON output (for piping into monitoring):
docker exec -w /app/apps/backend kuwaitpos-backend \
  node dist/scripts/qb-health-check.js --json

# Skip the live QB COA query (faster; less complete):
docker exec -w /app/apps/backend kuwaitpos-backend \
  node dist/scripts/qb-health-check.js --skip-coa
```

### Cron install (one-time, on the server)
```bash
# 1. Make wrapper executable
chmod +x /opt/kuwaitpos/scripts/cron-qb-health.sh

# 2. Add crontab entry (runs daily at 06:00 UTC)
crontab -e
# add this line:
0 6 * * * /opt/kuwaitpos/scripts/cron-qb-health.sh >> /var/log/kuwaitpos-qb-health.log 2>&1

# 3. (Optional) wire up Slack/Discord alerting — add to backend .env:
QB_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
# then redeploy backend so the new env var is picked up
```

### Exit codes
| code | meaning |
|------|---------|
| 0 | healthy, no issues |
| 1 | unhealthy, see stdout |
| 2 | crashed (env vars missing, DB unreachable, etc.) |

### Triage playbook by issue type
- **dead_letter**: the dispatcher couldn't post after `maxRetries` retries. Check `qb_sync_log` for the failing job. Common causes: account/customer mapping points at a deleted QB entity (rebind via `qb-seed-discover --apply`) or QB rejected the payload (fix data + requeue: `UPDATE qb_sync_queue SET status='pending', retry_count=0, error_message=NULL WHERE id=...`).
- **stale mapping** (qb_id missing in QB / Active=false): re-run `qb-seed-discover --org <code> --apply` to rebind to the live QB ID, then requeue dead-letter jobs.
- **stuck pending/processing** > 30min: worker is wedged. Restart the backend container; check logs for the actual exception.
- **G/L rows with no QB JE**: typically a DRY_RUN job marked complete without writing. Reset the queue row (set `status='pending'`, give it a unique `idempotency_key` like `qb-dipvar-<id>-rerun`).
- **token expiring < 14d**: somebody needs to re-auth via the QB Connect button in admin settings before the refresh token (100-day TTL) elapses.

---

## 2. Per-org mapping seed (discovery)

### Purpose
Auto-resolve every canonical mapping (manifest entries + dynamic
per-row mappings) to the live QB IDs in a target org's realm. Use
this whenever a new tenant connects QB, or after a major COA reorg.

### Manifest
Single source of truth: `apps/backend/src/scripts/qb-mapping-manifest.ts`.
Each entry declares the canonical `local_id`, the QB entity type, and
ordered name patterns (most-specific first). Adding a new mapping = add
a manifest entry → run discover.

### Dry-run plan against an org
```bash
docker exec -w /app/apps/backend kuwaitpos-backend \
  node dist/scripts/qb-seed-discover.js --org kpc
# prints ✅/❌ per mapping; no DB writes
```

### Apply
```bash
docker exec -w /app/apps/backend kuwaitpos-backend \
  node dist/scripts/qb-seed-discover.js --org kpc --apply
# upserts every resolved mapping into qb_entity_mappings (idempotent)
```

### Onboarding a new org (e.g. SE)
1. Operator clicks **Connect QuickBooks** in the org's admin panel; OAuth flow stores the connection.
2. Run discovery dry-run:
   ```bash
   docker exec -w /app/apps/backend kuwaitpos-backend \
     node dist/scripts/qb-seed-discover.js --org se
   ```
3. Review unresolved (❌) entries. Either:
   - Add the missing entity in QB (most common — e.g. accountant hasn't created the loss-expense accounts yet for the new tenant), then re-run discover.
   - Extend the manifest's `namePatterns` if the entity exists under a different name in this realm.
4. Once the dry-run shows zero ❌, apply:
   ```bash
   docker exec -w /app/apps/backend kuwaitpos-backend \
     node dist/scripts/qb-seed-discover.js --org se --apply
   ```
5. Run `qb-health-check.js` to confirm the seed is clean.

### Pre-CompanyStartDate caveat
QB blocks transactions dated before each company's `CompanyStartDate`.
For backfills, the QB admin must move the start date back in QB
Settings before re-syncing those rows.

---

## 3. Common ops queries

```sql
-- Failure landscape
SELECT status, entity_type, job_type, COUNT(*)
FROM qb_sync_queue
GROUP BY status, entity_type, job_type
ORDER BY status, entity_type;

-- Reset a single dead-letter job to pending (replace ID)
UPDATE qb_sync_queue
SET status='pending', retry_count=0, error_message=NULL, error_code=NULL,
    error_detail=NULL, next_retry_at=NULL, completed_at=NULL,
    http_status_code=NULL, started_at=NULL, duration_ms=NULL,
    updated_at=now()
WHERE id='<job-uuid>';

-- See what each gain/loss row mapped to in QB
SELECT entity_id, response_payload->>'Id' AS qb_je_id,
       response_payload->>'DocNumber' AS doc, status, created_at
FROM quickbooks_audit_log
WHERE entity_type='inventory_adjustment'
  AND operation='CREATE_JOURNAL_ENTRY'
ORDER BY created_at DESC;
```
