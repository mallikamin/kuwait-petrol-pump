# Branching & Deployment Strategy

## Current Status (2026-04-10)

### MVP v1 (PRODUCTION BASELINE) ✅
- **Tag**: `mvp-v1`
- **Commit**: `fb0f901`
- **Date**: 2026-04-10 19:00 UTC
- **Status**: All tests passed, zero 409/500 errors
- **Features**: Drift fix stabilized, backdated entries + finalize + sales working
- **Backup Branch**: `mvp-v1-backup` (points to same commit)

## Branching Model

```
origin/master (PRODUCTION)
    ↓
    └─ mvp-v1 [TAG] ← Current production baseline
    └─ mvp-v1-backup [BRANCH] ← Safety backup

Feature Branch (for next changes):
    feature/ChangesMVPv2 (branched from master)
    ├─ Make changes
    ├─ Test locally
    ├─ Deploy to staging server
    ├─ Run full API test suite
    └─ When ready: PR → Code review → Merge to master
```

## Workflow for Feature Development

### 1. Create Feature Branch
```bash
# From local master
git checkout master
git pull origin master

# Create feature branch
git checkout -b feature/ChangesMVPv2
```

### 2. Make Changes & Commit
```bash
# Edit files
nano apps/backend/src/...

# Commit (standard format)
git add apps/backend/...
git commit -m "feat: description of change

Co-Authored-By: Malik Amin <amin@sitaratech.info>"
```

### 3. Test Locally
```bash
# Build backend
cd apps/backend
npm run build  # Must pass tsc

# Build frontend (if changed)
cd ../web
npm run build
```

### 4. Deploy to Production (Test in Staging)
```bash
# Push feature branch to remote
git push origin feature/ChangesMVPv2

# SSH to server, pull feature branch
ssh root@64.226.65.80
cd /root/kuwait-pos
git fetch origin feature/ChangesMVPv2
git checkout feature/ChangesMVPv2

# Rebuild backend
docker compose -f docker-compose.prod.yml up -d --build backend

# Run same API tests as master:
# - Edit transaction (40->240): Status 200
# - Add new transaction: Status 200
# - Posted totals update: Verified
# - Finalize day: Status 200 or 400 (with expected reason)
# - Sales endpoint: Status 200 with records
# - NO 409 errors, NO 500 errors
```

### 5. Merge to Master (When Tested)
```bash
# After successful production testing on feature branch:
git checkout master
git pull origin master

# Create PR or merge directly (your choice)
git merge feature/ChangesMVPv2
git push origin master

# Tag the release
git tag -a mvp-v2 -m "MVPv2 - [description of changes]"
git push origin mvp-v2

# Backup
git branch mvp-v2-backup
git push origin mvp-v2-backup
```

### 6. Cleanup
```bash
# After merge, delete feature branch
git branch -d feature/ChangesMVPv2
git push origin --delete feature/ChangesMVPv2
```

## Rollback Procedure

If production breaks:

```bash
# Option A: Rollback to last known good tag
ssh root@64.226.65.80
cd /root/kuwait-pos
git fetch origin
git checkout mvp-v1  # Goes to specific tag
docker compose -f docker-compose.prod.yml up -d --build backend

# Option B: Rollback to backup branch
git checkout mvp-v1-backup
docker compose -f docker-compose.prod.yml up -d --build backend
```

## Branch Status

| Branch | Commit | Status | Purpose |
|--------|--------|--------|---------|
| `master` | Current | ACTIVE | Production |
| `mvp-v1` [TAG] | fb0f901 | STABLE | Rollback point |
| `mvp-v1-backup` | fb0f901 | STABLE | Safety backup |
| `feature/ChangesMVPv2` | (pending) | FEATURE | Next feature dev |

## Key Rules

1. **Always test locally first** (npm run build must pass)
2. **Feature branches are disposable** - delete after merge
3. **Tags are permanent** - git tag -a for releases
4. **Backup branches never get deleted** - keep for historical rollback
5. **Production deploy only from master** (or specific release tag)
6. **API tests mandatory** before merging feature → master

## Example Scenario

```
TODAY (2026-04-10):
master/mvp-v1 ✅
│
├─ Next week: Create feature/ChangesMVPv2
│   ├─ Change 1: Update meter logic
│   ├─ Change 2: Fix reconciliation calculation
│   ├─ Deploy to prod as feature branch
│   ├─ API tests: All pass ✅
│   └─ Merge to master → Tag mvp-v2 → Backup mvp-v2-backup
│
└─ If issue found on mvp-v2:
    Rollback → git checkout mvp-v1 → Deploy → Investigate
```

## Production Deployment Checklist

**Before deploying ANY branch** (master, feature, or tag):

- [ ] Local build passes: `npm run build` ✅
- [ ] Git clean: `git status` shows nothing to commit
- [ ] Commit is pushed: `git push origin [branch]`
- [ ] Server pulls: `ssh git fetch origin && git checkout [branch]`
- [ ] Backend rebuilt: `docker compose up -d --build backend`
- [ ] Health check: `curl https://kuwaitpos.duckdns.org/api/health` → 200
- [ ] API test 1: Edit transaction (40→240) → 200, no 409
- [ ] API test 2: Add transaction → 200, no 409
- [ ] API test 3: Finalize day → 200 or 400 (expected), no 500
- [ ] API test 4: Sales endpoint → 200, records visible
- [ ] Log check: `docker logs kuwaitpos-backend | grep error` → only expected errors
- [ ] Sign off: Document in git commit or tag message

---

**Questions?** Review this file before making changes. Always ask before deviating from this process.
