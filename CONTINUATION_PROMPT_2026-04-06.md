# Continuation Prompt - Kuwait Petrol Pump POS
**Date:** April 6, 2026
**Session:** Additional Changes - 6th April
**Branch:** `feat/additional-changes-6thapril`
**Last Commit:** `b5a5754` (merged fuel persistence fix)

---

## 🎯 PROJECT STATUS

### Production Deployment (LIVE)
- **Server:** 64.226.65.80 (Frankfurt, DigitalOcean)
- **URL:** https://kuwaitpos.duckdns.org
- **Credentials:** admin / AdminPass123
- **Backend:** `kuwaitpos-backend:f053537` ✅ Healthy
- **Frontend:** `index-Ca3xGwK4.js` ✅ Deployed
- **Database:** PostgreSQL with latest schema (bank_id field added)
- **Last Deploy:** April 6, 2026, 13:43 UTC

### Recent Work Completed ✅
**Issue:** Fuel type selection lost after navigation in backdated transactions
**Fixed:** April 6, 2026
**Solution:**
- Backend now returns `fuelCode` field (HSD/PMG) in transaction API responses
- Added `bankId` field for card payment persistence
- Schema updated: `bank_id` column in `backdated_transactions` table
- Deployed to production and verified working with client ✅

**Commits merged to master:**
1. `3c4a363` - Backend: Persist fuelCode and bankId
2. `cd2a3bf` - Schema: Add Bank relation
3. `f053537` - Docs: ERROR_LOG update
4. `b5a5754` - Merge: feat/qb-entity-complete-mapping

---

## 📂 BRANCH INFORMATION

### Current Branch
- **Name:** `feat/additional-changes-6thapril`
- **Based on:** master @ `b5a5754`
- **Purpose:** New features/fixes for April 6, 2026
- **Status:** Clean working tree, no uncommitted changes

### Archived Branch
- **Tag:** `archive/feat/qb-entity-complete-mapping-2026-04-06`
- **Original Branch:** `feat/qb-entity-complete-mapping` (kept, not deleted)

---

## 🗂️ PROJECT STRUCTURE

```
kuwait-petrol-pump/
├── apps/
│   ├── backend/          # Node.js + Express + Prisma (deployed: f053537)
│   ├── web/              # React + Vite dashboard (deployed: Ca3xGwK4)
│   ├── desktop/          # Electron POS app (build currently broken)
│   └── mobile/           # React Native + Expo (OCR meter reading)
├── packages/
│   └── database/         # Prisma schema + migrations
├── ERROR_LOG.md          # ⚠️ READ FIRST before any changes
├── MEMORY.md             # Project context (see ~/.claude/memory/)
└── docker-compose.prod.yml  # Production deployment config
```

---

## 🔑 KEY CONTEXT FOR NEXT SESSION

### Deployment Protocol (MANDATORY)
**Always follow:** `C:\Users\Malik\.claude\memory\DEPLOYMENT_SAFETY_PROTOCOL.md`

**Non-Negotiable Rules:**
1. **pg_dump before every DB operation** — no exceptions
2. **Never use empty string in Radix Select** — use sentinel values (`__none__`, `__walkin__`)
3. **Git commits:** ALWAYS use `Co-Authored-By: Malik Amin <amin@sitaratech.info>`
4. **No destructive prod commands** without explicit approval
5. **Post-deploy verification:** Check git hash + bundle hash + API health
6. **Read ERROR_LOG.md** before making changes

### Current Production State
- **All services healthy:** backend, nginx, postgres, redis
- **Client testing:** Backdated transactions fuel persistence — WORKING ✅
- **No known issues:** System stable
- **Next UAT phase:** Client will test additional features

### Technology Stack
- **Backend:** Node.js 20, Express, Prisma 6.19.2, PostgreSQL 16, Redis 7
- **Frontend:** React 18, Vite 5, TypeScript 5.9, Radix UI
- **Deployment:** Docker Compose, nginx 1.25, Let's Encrypt SSL
- **Auth:** JWT (access + refresh tokens)

### Important Files to Read First
1. **ERROR_LOG.md** — Cumulative error history (read BEFORE coding)
2. **MEMORY.md** (in ~/.claude/memory/) — Project rules & context
3. **DEPLOYMENT_SAFETY_PROTOCOL.md** — Deployment checklist
4. **POST_DEPLOY_VERIFICATION.md** — Verification steps after deploy

---

## 🧪 HOW TO VERIFY CURRENT STATE

### Check Production Health
```bash
# Backend health
curl -sk https://kuwaitpos.duckdns.org/api/health

# Frontend bundle
curl -sk https://kuwaitpos.duckdns.org | grep -o 'index-[^"]*\.js'

# Server git commit
ssh root@64.226.65.80 "cd ~/kuwait-pos && git rev-parse --short HEAD"
```

### Test Login & API
```bash
# Login
curl -sk https://kuwaitpos.duckdns.org/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"AdminPass123"}'

# Use returned access_token for authenticated requests
```

---

## 📋 COMMON TASKS

### Local Development
```bash
# Start backend (from root)
pnpm --filter @petrol-pump/backend dev

# Start frontend (from root)
cd apps/web && npm run dev

# Database migrations
cd packages/database && npx prisma db push
```

### Deployment to Production
```bash
# 1. Build locally
cd apps/web && npm run build

# 2. Commit changes
git add . && git commit -m "fix: description

Co-Authored-By: Malik Amin <amin@sitaratech.info>"

# 3. Push to GitHub
git push origin feat/additional-changes-6thapril

# 4. Deploy (SSH to server)
ssh root@64.226.65.80
cd ~/kuwait-pos && git pull
# ... follow DEPLOYMENT_SAFETY_PROTOCOL.md
```

---

## ⚠️ KNOWN ISSUES / CONSTRAINTS

### Do NOT Fix (User Constraints)
- **GitHub Actions:** Cannot use (user doesn't have access)
- **Desktop App:** Build broken (deferred, not priority)
- **Expo Go SDK 50:** Unreliable (use custom dev client for mobile)

### Active Monitoring
- **nginx cache:** Frontend updates require bundle hash verification
- **Docker image tags:** Must use specific commit tags (not `:latest`)
- **Postgres user:** Production uses custom user (not `postgres` or `kuwaitpos`)

---

## 🎬 NEXT STEPS

Client will provide additional feedback/requirements for:
- Backdated entries enhancements
- Reports improvements
- QuickBooks sync optimizations
- Meter reading workflow tweaks

**Wait for client feedback before making changes.** System is stable and working.

---

## 📞 CONTACT INFORMATION

- **Client:** Kuwait-based petrol pump owner
- **Deployment:** Lahore, Pakistan (NOT Kuwait)
- **Server Region:** Frankfurt (closest to Lahore)
- **Domain:** kuwaitpos.duckdns.org (DuckDNS free subdomain)

---

**Ready for next session!** 🚀

Current branch: `feat/additional-changes-6thapril`
Working tree: Clean
Production: Healthy ✅
