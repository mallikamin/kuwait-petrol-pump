# Kuwait POS Backup System

Production-grade nightly backup with off-site replication, comprehensive verification, and email alerting.

> **Operational details + credentials:** see `C:\ST\Sitara Infotech\Tailscale\BACKUP-SYSTEMS.md` and `CREDENTIALS.md` (local-only, not committed). That folder is the cross-project source of truth for both this system and Orbit CRM, since they share the same off-site edge box (`loom-edge-01`).

## Architecture

```
                    Droplet (64.226.65.80)              Edge box (loom-edge-01, Tailscale)
                    ──────────────────────              ─────────────────────────────────
  11:00 PKT  ───►   backup-nightly.sh                   
                    ├─ pg_dump (custom format)          
                    ├─ tar uploads                       
                    ├─ per-tenant CSV bundles           
                    └─ rotation (7d/4w/6m)              
                                                         
  11:15 PKT  ───►   verify-comprehensive.sh             
                    ├─ restore into throwaway DB        
                    ├─ assert all 51 tables match       
                    └─ md5 checksum 6 critical tables   
                                                         
  11:30 PKT          ─── rsync over SSH ───►            rsync-offsite.sh (attempt 1)
  12:00 PKT          ─── rsync over SSH ───►            rsync-offsite.sh (attempt 2)
  12:30 PKT          ─── rsync over SSH ───►            rsync-offsite.sh (attempt 3)
  13:00 PKT          ─── rsync over SSH ───►            rsync-offsite.sh (attempt 4)
                                                         ├─ pull /root/kuwait-pos/backups/
                                                         ├─ read .last-run.json
                                                         └─ email alert on fail/stale/3-pull-fails
                                                                  │
                                                                  ▼
                                                         Gmail SMTP → mallikamiin@gmail.com
                                                                      amin@sitaratech.info
```

## Files

| File | Where it runs | Purpose |
|---|---|---|
| `backup-nightly.sh` | Droplet, daily 06:00 UTC | Full DB dump + uploads tar + per-tenant CSV bundles |
| `verify-comprehensive.sh` | Droplet, daily 06:15 UTC | Restore-test across all 51 tables + content checksums |
| `regression-check.sh` | Droplet, daily 06:30 UTC | Snapshot row counts + alert if any table shrunk vs yesterday (without ack) |
| `restore-test.sh` | Droplet, on-demand | Lightweight SE-only restore-test (kept for quick checks) |
| `edge.rsync-offsite.sh` | Edge box, daily 11:30/12:00/12:30/13:00 PKT | Pull + email on success/fail/regression |
| `cron.d.kuwait-pos-backups` | `/etc/cron.d/` on droplet | Scheduling |
| `logrotate.d.kuwait-pos-backups` | `/etc/logrotate.d/` on both hosts | 13-week log retention |

### Regression check — how it works

The verifier (`verify-comprehensive.sh`) checks **today's backup matches today's prod** (within-day integrity). The regression check goes further: it compares **today's prod vs yesterday's prod** (cross-day historical). If any table shrinks without explanation, you get an alert.

**Daily snapshot** stored at `/root/kuwait-pos/backups/row-counts/YYYY-MM-DD.json` (90-day retention).
**Ack file** at `/root/kuwait-pos/backups/regression-acks.json` (manually edited when a drop is intentional):
```json
{
  "2026-05-15": {
    "customers": "merged 5 duplicates after accountant audit (Malik)",
    "search_log": "auto-rotated old search history (system, monthly cleanup)"
  }
}
```

**Alert flow:**
- Drop detected + no ack → `[KuwaitPOS-Backup] REGRESSION DETECTED` email with table list + drop counts + instructions to either restore from backup or add ack
- Drop detected + ack present → success email mentions "N acked drops" so you have a record
- No drops → success email says "Regression check: OK"

## What gets backed up

- **Full pg_dump** (custom format, compressed) — covers all 51 tables including `backdated_meter_readings`, `backdated_entries`, `backdated_transactions`
- **Uploads volume** (`/opt/kuwaitpos/data/uploads`) — meter-reading photos
- **Per-tenant CSV bundles** for accountant audit (one zip per org, per day):
  - All directly-org-scoped tables (customers, suppliers, expense_*, qb_*, backdated_meter_readings, etc.)
  - JOIN-filtered exports for sales, meter_readings, backdated_entries, backdated_transactions
- **Status JSON** (`.last-run.json`, `.verify-comprehensive.json`) — machine-readable health signal

## Storage layout

**Droplet** (`/root/kuwait-pos/backups/`):
```
db/2026-05-02.dump
uploads/2026-05-02.tar.gz
tenants/kpc/2026-05-02.tar.gz
tenants/se/2026-05-02.tar.gz
.last-run.json
.last-run.log
.verify-comprehensive.json
.verify-comprehensive.log
```

**Edge** (`/srv/kuwait-pos-backups/`): exact mirror + `.pull-state.json`, `.pull.log`

## Retention

7 daily + 4 weekly (Sundays) + 6 monthly (1st of month) on **both** sides. Auto-pruned by `backup-nightly.sh`.

## Restoring from backup

### Restore the latest full dump to a test DB
```bash
ssh root@64.226.65.80
LATEST=$(ls -1t /root/kuwait-pos/backups/db/*.dump | head -1)
docker exec kuwaitpos-postgres psql -U petrolpump_prod -d postgres \
  -c "CREATE DATABASE petrolpump_recovery;"
cat "$LATEST" | docker exec -i kuwaitpos-postgres pg_restore \
  -U petrolpump_prod -d petrolpump_recovery --no-owner --no-acl
```

### Restore the off-site copy (if droplet died entirely)
```bash
ssh loom-edge-01@100.87.222.110
ls /srv/kuwait-pos-backups/db/   # pick a dump
# scp it back to the rebuilt droplet, restore as above
```

### Extract a tenant's CSV bundle for the accountant
```bash
cd /tmp
tar -xzf /root/kuwait-pos/backups/tenants/se/2026-05-02.tar.gz
ls 2026-05-02/   # all SE tables as CSV
```

## Alerting

All alerts go to `mallikamiin@gmail.com` + `amin@sitaratech.info` via Gmail SMTP from the **edge box** (DigitalOcean blocks outbound SMTP on droplets). Subject prefix: `[KuwaitPOS-Backup]`.

Alert triggers (each fires once per day):
- `BACKUP FAILED on droplet` — `.last-run.json` reports `status: fail`
- `BACKUP STALE — no fresh run in Xh` — last backup older than 26 hours
- `BACKUP STATUS UNKNOWN — no .last-run.json` — pull succeeded but no status file
- `PULL FAILING — droplet unreachable` — 3+ failed pull attempts in same day

Successful runs are silent (logged but not emailed) to avoid alert fatigue.

## Verification (production-grade gates)

Daily comprehensive verification asserts:
- All 51 tables present with matching row counts (prod vs restored)
- md5 checksums match for: customers, backdated_meter_readings, expense_accounts, suppliers, organizations, branches

Test runtime: ~20 seconds. Throwaway DB always dropped at end.

## Logs

13-week (~90 day) retention via logrotate, gzipped after 1 week:
- `/root/kuwait-pos/backups/.last-run.log` (every backup run)
- `/root/kuwait-pos/backups/.verify-comprehensive.log` (every verify run)
- `/srv/kuwait-pos-backups/.pull.log` (every edge pull attempt)

## Configuration secrets

- `~/.msmtprc` (chmod 600) on **edge box only** — Gmail SMTP credentials, never committed
- SSH key on edge (`~/.ssh/id_ed25519`) authorizes pull from droplet (restricted via `restrict` flag in droplet's `authorized_keys`)

## Adjusting timing

All cron entries in `cron.d.kuwait-pos-backups` (droplet, UTC) and edge user crontab (PKT). Update both if changing the daily window.

## Troubleshooting

### "I didn't get an alert but I expected one"
- Check edge `.pull.log` and `.pull-state.json` (`alerted_*` flags reset at next day)
- Check edge `~/.msmtp.log` for SMTP errors
- Verify edge box is online: `tailscale status` from any tailnet machine

### "Backup is running but I want to skip tonight"
```bash
ssh root@64.226.65.80
touch /root/kuwait-pos/backups/.skip-tonight  # NOT YET IMPLEMENTED — would need to add this check to backup-nightly.sh
```

### "I need to test the alert pipeline"
SSH into the edge box and manually create a fake fail status, then trigger the pull:
```bash
ssh loom-edge-01@100.87.222.110
echo '{"status":"fail","ts":"2026-05-02T12:00:00+00:00","ts_date":"2026-05-02","host":"test","error":"manual test"}' \
  > /srv/kuwait-pos-backups/.last-run.json
rm /srv/kuwait-pos-backups/.pull-state.json  # clear "alerted_backup" flag
~/scripts/rsync-offsite.sh  # this will re-pull but the local fake .last-run.json is what's read first... actually need to time this between pulls. easier: edit pull-state.json to set alerted_backup=false then re-trigger.
```
