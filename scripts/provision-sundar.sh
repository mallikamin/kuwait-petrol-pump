#!/usr/bin/env bash
# Provision Sundar Estate as the second tenant in the multi-tenant pool.
# Idempotent: re-running this is safe, every step skips if already done.
#
# Run this on the production server AFTER `./scripts/deploy.sh` has applied
# the 20260426_multi_tenant_foundation migration:
#
#   ssh root@64.226.65.80
#   cd /root/kuwait-pos
#   bash scripts/provision-sundar.sh
#
# Steps:
#   1. Create Organization "Sundar Estate" with code "se"
#   2. Create Branch "b01"
#   3. Create user se-b01-001 (operator, branch-scoped)
#   4. Create user se-acc     (accountant, org-level — sees all branches)
#
# Username convention adopted across the SaaS:
#   <org-code>-<branch-code>-<seq>     branch-scoped users (operators, cashiers)
#   <org-code>-<branch-code>-<role>    branch-scoped role-named users
#   <org-code>-<role>                  org-level users (e.g. accountant covering all branches)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ORG_CODE="se"
ORG_NAME="Sundar Estate"
COMPANY_NAME="Sundar Estate Filling Station"
COMPANY_ADDRESS="Sundar Estate, Pakistan"
BRANCH_CODE="b01"
BRANCH_NAME="Sundar Estate Branch 01"

# Default password for initial provisioning. Operators should rotate this
# on first login (or admin can rotate via change-password endpoint).
INITIAL_PASSWORD="${INITIAL_PASSWORD:-seb123}"

run_in_backend() {
  if [ -n "${SUNDAR_LOCAL:-}" ]; then
    (cd "$REPO_ROOT/apps/backend" && npm run "$@")
  else
    docker exec kuwaitpos-backend sh -c "cd /app/apps/backend && npm run $*"
  fi
}

echo "Step 1/4: Create Organization '$ORG_NAME' (code=$ORG_CODE)"
run_in_backend onboard:client -- \
  --code "$ORG_CODE" \
  --name "$ORG_NAME" \
  --company-name "$COMPANY_NAME" \
  --company-address "$COMPANY_ADDRESS"
echo

echo "Step 2/4: Create Branch '$BRANCH_NAME' (code=$BRANCH_CODE)"
run_in_backend onboard:branch -- \
  --org-code "$ORG_CODE" \
  --code "$BRANCH_CODE" \
  --name "$BRANCH_NAME"
echo

echo "Step 3/4: Create operator se-b01-001 (branch-scoped)"
run_in_backend onboard:user -- \
  --org-code "$ORG_CODE" \
  --branch-code "$BRANCH_CODE" \
  --username "se-b01-001" \
  --role operator \
  --password "$INITIAL_PASSWORD" \
  --full-name "Sundar Estate Operator 01"
echo

echo "Step 4/4: Create accountant se-acc (org-level — all branches)"
run_in_backend onboard:user -- \
  --org-code "$ORG_CODE" \
  --username "se-acc" \
  --role accountant \
  --password "$INITIAL_PASSWORD" \
  --full-name "Sundar Estate Accountant"
echo

echo "Sundar Estate provisioned. Logins:"
echo "  se-b01-001  / $INITIAL_PASSWORD   (operator, Branch 01)"
echo "  se-acc      / $INITIAL_PASSWORD   (accountant, all branches)"
echo
echo "Next: owner connects their QuickBooks Online via the in-app Connect QuickBooks flow."
