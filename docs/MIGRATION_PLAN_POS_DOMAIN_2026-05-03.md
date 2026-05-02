# Migration Plan — POS Domain → fuelpos.sitaratech.info

- **Date:** 2026-05-03
- **Status:** ACTIVE — phased execution gated by user approval at every step
- **Old domain:** `kuwaitpos.duckdns.org` (kept alive 30–60 days with notice banner)
- **New domain:** `fuelpos.sitaratech.info`
- **Server:** 64.226.65.80 (DigitalOcean Frankfurt, unchanged)
- **Edge architecture:** Cloudflare DNS (no proxy) + existing Let's Encrypt certbot flow (option C — most portable, fewest moving parts)
- **DNS authority:** Cloudflare (already managing sitaratech.info via CF Pages)
- **Production fallback commit:** `3da3385` (master, PR #54 merged)
- **Fallback git tag:** `pre-domain-migration-3da3385` (created Phase 0)

---

## Hard rules for this migration

1. **Production must keep working at the old URL throughout** until Phase 9 sunset. Both URLs serve identical app simultaneously.
2. **No frontend code change for routing/API.** SPA already uses same-origin (`VITE_API_URL=` empty in `apps/web/.env.production`).
3. **No tenant code changes.** JWT-based org resolution unchanged. Wildcard DNS reserved for future host-based routing.
4. **No mobile app changes during migration** (mobile is frozen per CLAUDE.md). Mobile continues using duckdns; migrate on next mobile build.
5. **Each phase has a single rollback path** documented inline.
6. **PR strategy mandatory:** every code change → feature branch → GitHub PR → merge after explicit user approval → canonical `./scripts/deploy.sh`.
7. **Commit-before-build always.** No deploy on dirty git tree.
8. **No commit co-authors except Malik Amin.** Per `feedback_commit_coauthor`.

---

## Decisions (locked 2026-05-03)

| # | Decision | Value |
|---|----------|-------|
| 1 | New domain | `fuelpos.sitaratech.info` |
| 2 | Edge architecture | Cloudflare DNS (no proxy) + existing certbot Let's Encrypt |
| 3 | DNS provider for sitaratech.info | Cloudflare (already authoritative via CF Pages for marketing site) |
| 4 | Notice style on duckdns | Banner above app (option i) — non-dismissable 30 days, dismissable 30 more, 301 redirect after 60 |
| 5 | Reserve wildcard DNS | Yes — `*.fuelpos.sitaratech.info` for future per-tenant URLs (no code change in this migration) |
| 6 | Tenant routing changes | None this migration |
| 7 | Mobile migration | Deferred until next mobile build |
| 8 | DuckDNS afterlife | Retain at registrar for infra plumbing (edge box, internal tools); retired from production user traffic |

---

## Inventory of all references found

### 🔴 Blockers (must be updated for migration to work)

| Path | Lines | Type |
|------|-------|------|
| `nginx/nginx.conf` | 74, 112, 115–117 | server_name + cert paths |
| `nginx/nginx.conf.full` | 74, 99, 102–104 | server_name + cert paths |
| `nginx/nginx-bootstrap.conf` | 23 | server_name |
| `nginx/conf.d/security.conf` | 19 | CSP `connect-src` (HARD BREAKER — blocks API on new domain until updated) |
| `apps/backend/src/services/quickbooks/startup-validation.ts` | 35–46 | Hardcoded `kuwaitpos` substring check (FATALs backend if QB redirect changes) |
| `scripts/deploy.sh` | 14 | `SERVER_APP_URL` (post-deploy health check) |
| `.github/workflows/deploy.yml` | 167, 208, 213, 233 | CORS_ORIGIN, QB redirect, health check |
| `apps/web/public/terms.html` | (link) | Displayed website text |
| `apps/web/public/privacy.html` | (link) | Displayed website text |
| **Server `.env`** (off-repo) | — | `CORS_ORIGIN`, `FRONTEND_URL`, `QUICKBOOKS_REDIRECT_URI` |
| **Intuit Developer Portal** (external) | — | QB OAuth redirect URI allowlist |
| **Cloudflare DNS** (external) | — | Add `A fuelpos → 64.226.65.80` and `*.fuelpos` wildcard |
| **Let's Encrypt** (external) | — | Provision cert for `fuelpos.sitaratech.info` |

### 🟡 Lag (update on natural rebuild)

| Path | Notes |
|------|-------|
| `apps/mobile/eas.json:30` | `EXPO_PUBLIC_API_URL` — next mobile build only |
| `scripts/health-check.sh:18,77,78` | URL + cert paths |
| `scripts/smoke_gain_loss.sh:24` | API default |

### 🟢 Cosmetic (text only, can lag indefinitely)

- `.github/PR3_*.md`, `.github/REVALIDATION_PAUSE.md` — historical PR docs
- `archive/root-cleanup-2026-03-29/*` — already archived
- `apps/backend/src/scripts/seed-banks.ts:22` — code comment
- `apps/web/dist/*` — build artifacts (regenerate)
- All dated `*.md` reports in repo root

---

## Phased execution (all gated)

### Phase 0 — Prep (no production changes) ✅ executing

- [x] Save this plan
- [ ] Tag fallback: `git tag pre-domain-migration-3da3385 && git push --tags`
- [ ] Memory: add migration-in-progress entry with status

### Phase 1 — Backend code prep (single PR)

**Goal:** make backend domain-agnostic without changing current behavior.

**Change:** patch `apps/backend/src/services/quickbooks/startup-validation.ts` to replace hardcoded `kuwaitpos` substring check with **env-var-driven allowlist** that defaults to current value.

```ts
// New env var (with safe default)
const allowedHostsRaw = process.env.QB_REDIRECT_URI_ALLOWED_HOSTS || 'kuwaitpos.duckdns.org';
const allowedHosts = allowedHostsRaw.split(',').map(h => h.trim()).filter(Boolean);

let redirectHost: string;
try {
  redirectHost = new URL(redirectUri).host;
} catch {
  console.error('[QB] FATAL: Invalid QUICKBOOKS_REDIRECT_URI:', redirectUri);
  process.exit(1);
}

if (!allowedHosts.includes(redirectHost)) {
  console.error('[QB] FATAL: QUICKBOOKS_REDIRECT_URI host not in allowlist');
  console.error('[QB] Current host:', redirectHost);
  console.error('[QB] Allowed:', allowedHosts);
  process.exit(1);
}
```

**Why safe to deploy now:**
- Default `'kuwaitpos.duckdns.org'` matches existing production env exactly
- No new env var required at deploy time — current production keeps working
- When we add new domain later (Phase 4), set `QB_REDIRECT_URI_ALLOWED_HOSTS=kuwaitpos.duckdns.org,fuelpos.sitaratech.info` in server env

**Deploy:** feature branch → PR → user approves → merge → `./scripts/deploy.sh backend-only`

**Verification gate:**
- Backend boots without errors
- Logs: `[QB] ✅ Startup validation passed (production mode, host-isolated)`
- `curl -sk https://kuwaitpos.duckdns.org/api/health` → 200
- QB sync still works (queue-processor running, no errors)

**Rollback:** `git revert <sha>`, redeploy.

### Phase 2 — Infra prep (DNS + cert + nginx, no traffic shift)

**Goal:** new domain resolves and serves alongside old domain. Zero user impact.

**Steps (server-side, after user approval):**

1. **Cloudflare DNS** (manual, in CF dashboard for sitaratech.info):
   - `A fuelpos 64.226.65.80` (proxy: OFF — using direct DNS for option C)
   - `A *.fuelpos 64.226.65.80` (proxy: OFF — wildcard for future tenant subdomains)
   - TTL: Auto

2. **Wait for DNS propagation** (~5 min): `dig +short fuelpos.sitaratech.info` returns `64.226.65.80`

3. **Provision Let's Encrypt cert** on server:
   ```bash
   docker compose -f docker-compose.prod.yml exec certbot certbot certonly \
     --webroot -w /var/www/certbot \
     -d fuelpos.sitaratech.info \
     --email amin@sitaratech.info \
     --agree-tos --no-eff-email
   ```

4. **Add second nginx server block** for new domain (HTTP redirect-to-HTTPS + HTTPS), pointing to same backend. Old kuwaitpos server blocks **untouched**.

5. **Update CSP** in `nginx/conf.d/security.conf` to allow both origins:
   ```
   connect-src 'self' https://kuwaitpos.duckdns.org https://fuelpos.sitaratech.info;
   ```

6. **Reload nginx** (zero downtime): `docker compose exec nginx nginx -s reload`

**Verification gate:**
- `curl -sk https://fuelpos.sitaratech.info/api/health` → 200
- `curl -sk https://kuwaitpos.duckdns.org/api/health` → 200 (still)
- Browser: open `https://fuelpos.sitaratech.info` → SPA loads, login works
- SSL: `openssl s_client -connect fuelpos.sitaratech.info:443 -servername fuelpos.sitaratech.info` shows valid chain

**Rollback:**
- Remove new server block from nginx config
- Reload nginx
- Old domain unaffected throughout

### Phase 3 — Backend env swap (additive)

**Goal:** backend accepts requests from both origins.

**On server, edit `.env`:**
```
CORS_ORIGIN=https://fuelpos.sitaratech.info,https://kuwaitpos.duckdns.org,http://localhost:3000,http://localhost:3001,http://localhost:5173
FRONTEND_URL=https://fuelpos.sitaratech.info
# QUICKBOOKS_REDIRECT_URI unchanged for now (Phase 4)
```

Restart backend: `docker compose -f docker-compose.prod.yml restart backend`

**Verification gate:**
- Login from `https://fuelpos.sitaratech.info` works
- Login from `https://kuwaitpos.duckdns.org` works
- Browser network tab: no CORS errors on either domain
- Backend logs: `🔐 CORS Origin: https://fuelpos.sitaratech.info,https://kuwaitpos.duckdns.org,...`

**Rollback:** revert `.env` to old `CORS_ORIGIN` and `FRONTEND_URL`, restart.

### Phase 4 — QuickBooks redirect URI swap (delicate, do during low-traffic window)

**Why delicate:** existing refresh tokens are tied to current redirect URI. We must add the new URI to Intuit allowlist *before* changing env var, and verify both old and new auth flows work.

**Steps:**

1. **Intuit Developer Portal**: add `https://fuelpos.sitaratech.info/api/quickbooks/oauth/callback` to the QB app's allowed redirect URIs (alongside existing). Keep old URI in allowlist.

2. **Update server `.env`:**
   ```
   QUICKBOOKS_REDIRECT_URI=https://fuelpos.sitaratech.info/api/quickbooks/oauth/callback
   QB_REDIRECT_URI_ALLOWED_HOSTS=kuwaitpos.duckdns.org,fuelpos.sitaratech.info
   ```

3. **Restart backend:** `docker compose -f docker-compose.prod.yml restart backend`

**Verification gate:**
- Backend boots without QB FATAL
- Existing refresh tokens work: trigger a sync from any org, check `qb_sync_log`
- New OAuth flow works: in admin UI, disconnect+reconnect QB for a test org, verify redirect lands on new domain and tokens persist

**Rollback (if QB sync breaks):**
- Revert `QUICKBOOKS_REDIRECT_URI` in `.env`
- Revert `QB_REDIRECT_URI_ALLOWED_HOSTS`
- Restart backend
- Remove new URI from Intuit allowlist (optional)

### Phase 5 — Frontend rebuild (text refs in HTML)

**Single PR:** update terms.html, privacy.html text references. Build, deploy via `./scripts/deploy.sh frontend-only`.

**Verification gate:** bundle hash changed; `terms.html` and `privacy.html` show new domain on both URLs.

**Rollback:** `git revert`, redeploy frontend-only.

### Phase 6 — CI / scripts updates (single PR)

Update `.github/workflows/deploy.yml`, `scripts/deploy.sh`, `scripts/health-check.sh`, `scripts/smoke_gain_loss.sh`.

**No production behavior change** — these only affect CI verification and local scripts.

**Verification gate:** next CI run passes; manual smoke script passes.

### Phase 7 — Notice banner on duckdns

**Approach:** banner only renders when `window.location.hostname === 'kuwaitpos.duckdns.org'`. Single React component mounted at root, non-dismissable for first 30 days (configurable via env), dismissable for second 30 days, then 301 redirect.

Implementation: small `<DomainMigrationBanner/>` in `apps/web/src/App.tsx`. Hostname-based render — same bundle deployed everywhere, behavior changes per host.

**Single PR + frontend-only deploy.**

**Verification gate:** banner visible on duckdns, invisible on fuelpos.

### Phase 8 — Soak (30–60 days, monitoring only)

**Daily checks:**
- nginx access logs: requests by Host header (volume migrating from duckdns → fuelpos)
- Error rate per host
- QB OAuth success/failure
- No support tickets about broken bookmarks

**Schedule a follow-up agent in 30 days to report migration status and propose Phase 9 timing.**

### Phase 9 — Sunset duckdns from production

After soak window, when fuelpos traffic ≥ 95% of total:

1. Replace duckdns nginx server blocks with single 301 redirect → `https://fuelpos.sitaratech.info`
2. Remove `kuwaitpos.duckdns.org` from `CORS_ORIGIN`
3. Remove old URI from Intuit allowlist
4. Set `QB_REDIRECT_URI_ALLOWED_HOSTS=fuelpos.sitaratech.info`
5. Update mobile app on next build
6. Keep duckdns at registrar (free) for **infra plumbing only**: edge box, internal tools, dev/test
7. Update memory: which avenues retain duckdns, which retired

---

## Memory entries to update post-migration

- Update `MEMORY.md` PROJECT IDENTITY block: domain → `fuelpos.sitaratech.info`
- Add `domain_migration_2026-05-03.md` entry with status
- Update `credentials_in_use.md` URLs if any
- Update `backup_system_2026-05-02.md` URLs if any
- DuckDNS-retained avenues remain documented in `reference_tailscale_kb.md`

---

## Quick reference — cutover commands (when approved)

```bash
# Phase 0 (do now)
git tag pre-domain-migration-3da3385
git push origin pre-domain-migration-3da3385

# Phase 1 — feature branch
git checkout -b feature/migration-phase1-qb-validation-flexibility

# ... (apply patch, commit, push, PR, merge)
./scripts/deploy.sh backend-only

# Phase 2 — server-side (after user approval, on 64.226.65.80)
# (DNS done in CF dashboard manually, then:)
docker compose -f docker-compose.prod.yml exec certbot certbot certonly \
  --webroot -w /var/www/certbot -d fuelpos.sitaratech.info \
  --email amin@sitaratech.info --agree-tos --no-eff-email

# (edit nginx.conf to add second server block, edit conf.d/security.conf for CSP)
docker compose exec nginx nginx -t   # syntax check
docker compose exec nginx nginx -s reload

# Phase 3 — server `.env` edit, restart
docker compose -f docker-compose.prod.yml restart backend
```

---

**Next action:** await user approval for Phase 1 patch — show diff, then create feature branch.
