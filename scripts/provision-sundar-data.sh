#!/usr/bin/env bash
# Seed Sundar Estate (org `se`, branch `b01`) with the same master/dropdown
# data as the demo org (`kpc`):
#   - dispensing units + nozzles (branch structure mirrors demo b01)
#   - products, suppliers, customers, expense accounts
#   - 1 single shift "Day" 00:00-23:59 (NOT cloned from demo's 2 shifts —
#     Sundar's accountant works backdated, doesn't open/close shifts daily)
#
# Also fixes se-acc.branch_id = b01 so the Nozzles/Branches/Reports pages
# work (the existing UI assumes every user has branch_id set; org-level
# users are a future-PR concern). Sundar is single-branch today, so giving
# se-acc a branch context is consistent with how the demo accountant is
# configured and unblocks the page errors.
#
# Idempotent — safe to re-run. Skips what already exists.
#
# Run on the production server after deploy:
#   ssh root@64.226.65.80
#   cd /root/kuwait-pos
#   bash scripts/provision-sundar-data.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

run_in_backend() {
  if [ -n "${SUNDAR_LOCAL:-}" ]; then
    (cd "$REPO_ROOT/apps/backend" && npm run "$@")
  else
    docker exec -w /app/apps/backend kuwaitpos-backend npm run "$@"
  fi
}

run_psql() {
  local sql="$1"
  if [ -n "${SUNDAR_LOCAL:-}" ]; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${POSTGRES_HOST:-localhost}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "$sql"
  else
    docker exec kuwaitpos-postgres bash -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"$sql\""
  fi
}

echo "Step 1/3: Clone master data from kpc -> se (branch b01:b01)"
run_in_backend onboard:clone -- \
  --from-org kpc --to-org se \
  --branch-mapping b01:b01 \
  --include branch-structure,products,suppliers,customers,expense-accounts
echo

echo "Step 2/3: Create single shift 'Day' (00:00-23:59) for Sundar Estate Branch 01"
# Idempotent: ON CONFLICT skip. Uniqueness is per branch + shift_number.
run_psql "
INSERT INTO shifts (branch_id, shift_number, name, start_time, end_time, is_active)
SELECT b.id, 1, 'Day', '00:00:00'::time, '23:59:59'::time, true
  FROM branches b
  JOIN organizations o ON o.id = b.organization_id
 WHERE o.code = 'se' AND b.code = 'b01'
   AND NOT EXISTS (
     SELECT 1 FROM shifts s
      WHERE s.branch_id = b.id AND s.shift_number = 1
   );
SELECT shift_number, name, start_time, end_time FROM shifts WHERE branch_id = (SELECT b.id FROM branches b JOIN organizations o ON o.id=b.organization_id WHERE o.code='se' AND b.code='b01');
"
echo

echo "Step 3/3: Set se-acc.branch_id = b01 so the existing UI pages work"
# The current frontend assumes user.branch_id is always set. Org-level
# users (branch_id=NULL) hit "No branch found" on Nozzles/Branches/etc.
# Mirror how the demo accountant is configured: branch context = the
# tenant's primary branch. Re-runs are safe — already pointing to b01
# is a no-op.
run_psql "
UPDATE users
   SET branch_id = (
     SELECT b.id FROM branches b
       JOIN organizations o ON o.id = b.organization_id
      WHERE o.code = 'se' AND b.code = 'b01'
   )
 WHERE username = 'se-acc' AND branch_id IS NULL;
SELECT username, role, branch_id IS NOT NULL AS has_branch FROM users WHERE username IN ('se-acc','se-b01-001');
"
echo

echo "Sundar Estate master data provisioned. Re-login as se-acc to pick up the new branch context."
