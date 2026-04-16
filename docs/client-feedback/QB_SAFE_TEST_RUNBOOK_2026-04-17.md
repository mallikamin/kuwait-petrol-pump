# QB-Only Safety Runbook - Production Realm

Date: 2026-04-17
Goal: Protect existing QuickBooks data while validating full transaction flow.

## Important Constraint
- There is no "test environment inside production QB company".
- Safe options are:
  1) Separate QuickBooks Sandbox company (best isolation)
  2) Production realm in `DRY_RUN` mode (no QB writes)

## What We Mean by "QB Backup"
QuickBooks Online has no one-click full-company backup/restore via API.
So we create an immutable snapshot bundle before any change:

1. `Chart of Accounts` export (all accounts)
2. `Customers` export
3. `Items/Services` export
4. `Payment Methods` export
5. `Terms` export
6. Current app mappings export (`/api/quickbooks/mappings/export?format=xlsx`)
7. Controls state export (`/api/quickbooks/controls`, `/api/quickbooks/safety-gates`)

Store all files in:
- `docs/client-feedback/snapshots/<timestamp>/`

## Safe Validation Plan (No Data Risk)
1. Set controls to `syncMode=DRY_RUN`, `killSwitch=false`.
2. Run transaction flow cases end-to-end:
- Walk-in PMG sale
- Walk-in HSD sale
- Walk-in non-fuel cash sale
- Credit customer sale (invoice path)
- Receipt via selected bank channel
3. Verify logs/results:
- Dry-run markers in sync logs
- Correct account routing
- Zero new documents created in QB company
4. Stop and review output before any apply.

## If You Still Want Real QB Write Testing
- Do a tiny bounded pilot only after approval.
- Tag every test doc with deterministic prefix (e.g. `TEST-YYYYMMDD-...`).
- Use cleanup playbook (void/delete/inactivate where supported).
- This is higher risk than DRY_RUN and should be last step.

## Locked Mapping Decisions
- cash -> `90` Cash in Hand (all cash sales)
- exclude `93` Petty Cash
- card/bank receipts -> selected bank account directly
- add COGS split keys: `cogs_hsd`, `cogs_pmg`, `cogs_nonfuel`
- walk-in: SalesReceipt only, customer `71`, cash `90`
- non-fuel income -> `82`
- block parent posting heads: `79`, `83`, `87`
- production realm first
- review output first, no immediate apply
