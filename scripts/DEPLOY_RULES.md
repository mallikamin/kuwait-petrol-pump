# Deployment Rules - Kuwait Petrol Pump POS

## Canonical Deploy Command (ONLY Way to Deploy)

```bash
./scripts/deploy.sh
```

**This is the ONLY approved deployment method.**

---

## Hard Rules (No Exceptions)

### 1. Clean Git Tree Required
- Deploy script enforces `require-clean-git.sh` at start
- **Cannot be bypassed** - script exits immediately on dirty tree
- Defense in depth: npm prebuild hooks also check

### 2. No --ignore-scripts Flag
```bash
# ❌ FORBIDDEN - Bypasses prebuild guard
npm run build --ignore-scripts

# ✅ CORRECT - Guard runs automatically
npm run build
```

**Why forbidden:** `--ignore-scripts` skips prebuild hooks, allowing builds on dirty tree.

### 3. No Manual Build Commands During Deploy
```bash
# ❌ FORBIDDEN - Ad-hoc commands bypass guard
cd apps/backend && tsc
cd apps/web && vite build

# ✅ CORRECT - Use canonical script
./scripts/deploy.sh
```

**Why forbidden:** Manual commands skip the deploy script's guard check.

### 4. Single Commit Rule: Code XOR Docs
```bash
# ❌ FORBIDDEN - Mixed commit
git add src/file.ts docs/STATUS.md
git commit -m "fix + status update"

# ✅ CORRECT - Separate commits
git add src/file.ts
git commit -m "fix(module): description"
git add docs/STATUS.md
git commit -m "docs: update status"
```

**Why forbidden:**
- Code commits should be deployable immediately
- Docs/status files are NOT production artifacts
- Mixing them creates deploy ambiguity

---

## Enforcement Layers

### Layer 1: npm prebuild Hooks
```json
{
  "scripts": {
    "prebuild": "bash ../../scripts/require-clean-git.sh",
    "build": "tsc"
  }
}
```
- Runs BEFORE every `npm run build`
- Blocks if `git status --porcelain` is non-empty
- Active in: root, backend, web

### Layer 2: Canonical Deploy Script
```bash
# scripts/deploy.sh line 11-13
echo "Step 1/6: Checking git tree..."
bash "$(dirname "$0")/require-clean-git.sh"
```
- Runs BEFORE any build commands
- Cannot be bypassed (hard-coded at start)
- Exits on dirty tree

### Layer 3: Manual Review (Human)
Before running deploy:
```bash
git status --porcelain  # Must be empty
git log --oneline -n 1  # Verify commit hash
```

---

## Deploy Workflow (Correct Sequence)

### Step 1: Code Changes
```bash
# Make changes
vim src/file.ts

# Test locally (optional, not required before commit)
npm run dev
# Manual testing...

# Commit (BEFORE build)
git add src/file.ts
git commit -m "fix(module): description

Co-Authored-By: Malik Amin <amin@sitaratech.info>"
```

### Step 2: Deploy Build
```bash
# Run canonical deploy script
./scripts/deploy.sh

# Output:
# ✅ Git tree is clean. Build allowed.
# ✅ Backend build complete
# ✅ Frontend build complete
# ✅ Build artifacts verified
# Commit to deploy: abc1234
```

### Step 3: Server Deployment
Follow instructions from deploy script output:
```bash
# Backend
ssh root@64.226.65.80
cd ~/kuwait-pos
git fetch && git checkout abc1234
docker build -f Dockerfile.prod -t kuwaitpos-backend:abc1234 .
docker tag kuwaitpos-backend:abc1234 kuwaitpos-backend:latest
docker compose -f docker-compose.prod.yml up -d backend

# Frontend
scp -r apps/web/dist root@64.226.65.80:~/kuwait-pos/apps/web/dist_new
ssh root@64.226.65.80 'cd ~/kuwait-pos/apps/web && mv dist dist_old && mv dist_new dist'
ssh root@64.226.65.80 'docker compose -f docker-compose.prod.yml restart nginx'
```

### Step 4: Verification
Run ALL gates from CLAUDE.md:
- Login works
- Sales filter works
- QB mapping works
- Bundle hash changed
- etc.

### Step 5: Docs (Optional, Separate Commit)
```bash
# AFTER deploy is verified, document changes
vim docs/CHANGELOG.md
git add docs/CHANGELOG.md
git commit -m "docs: Add changelog for abc1234 deploy"
```

---

## CI/CD Integration (Future)

When adding CI/CD (GitHub Actions, etc.), ensure:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # GUARD: Enforce clean tree in CI
      - name: Check git tree
        run: bash ./scripts/require-clean-git.sh

      # Use canonical deploy script (NOT custom commands)
      - name: Build
        run: bash ./scripts/deploy.sh

      # Deploy steps...
```

**Rules for CI:**
- Must call `require-clean-git.sh` before any build
- Must use `scripts/deploy.sh` (not custom build commands)
- No `--ignore-scripts` flag allowed
- Fail pipeline on dirty tree

---

## Violation Consequences

### What Happens If Guard Is Bypassed?

**Symptom:** Build runs on uncommitted changes
**Result:**
- Deploy package contains uncommitted code
- Rollback impossible (no commit hash)
- Unknown production state
- Data integrity risk

**Recovery:**
1. Immediately halt deployment
2. Discard build artifacts
3. Commit all changes
4. Re-run `./scripts/deploy.sh` from clean tree
5. Verify commit hash matches deployed code

---

## Examples

### ✅ CORRECT: Clean Deploy
```bash
# 1. Make changes
vim src/auto-match.service.ts

# 2. Commit FIRST
git add src/auto-match.service.ts
git commit -m "fix(QB): Exclude mapped account needs"

# 3. Build AFTER commit (guard passes)
./scripts/deploy.sh
# Output: ✅ Git tree is clean. Build allowed.

# 4. Deploy with commit hash
# Commit to deploy: 7edb616
```

### ❌ WRONG: Bypass Attempt
```bash
# 1. Make changes
vim src/auto-match.service.ts

# 2. Build WITHOUT committing
npm run build --ignore-scripts  # ❌ BYPASSES GUARD

# 3. Deploy dirty build
# DANGER: Production has uncommitted code!
```

### ❌ WRONG: Mixed Commit
```bash
git add src/file.ts docs/STATUS.md
git commit -m "fix + status"
# ❌ Production code mixed with docs
# ❌ Cannot cherry-pick fix without docs
```

---

## Audit Trail

Every deploy must record:
1. Commit hash deployed
2. Build timestamp
3. Deploy timestamp
4. Verification results

Example:
```
Deployed: 7edb616
Built: 2026-04-07 18:30 UTC
Deployed: 2026-04-07 18:45 UTC
Verified: All 7 gates passed
```

Store in: `DEPLOY_LOG.md` (append-only)
