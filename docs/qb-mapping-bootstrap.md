# QB Mapping Bootstrap

Seeds the `qb_entity_mappings` rows required by the Phase 2-5 accounting
modules (expenses, cash reconciliation, customer advances, PSO
top-ups). Looks up each target in QuickBooks by name and upserts the
mapping. Idempotent. Safe to run repeatedly.

## When to run

- After the pump's QuickBooks OAuth connection is live but before
  issuing the first customer advance deposit, PSO top-up, or cash
  expense — otherwise those posts fail with `Missing mapping: …`.
- After any admin rename of the target QB accounts/customers/vendors
  (re-resolves and refreshes the mapping rows).

## Required mappings

| Local key                          | QB entity | Candidate names tried (first match wins)                       | Used by                                                   |
| ---------------------------------- | --------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `account/customer-advance`         | Account   | Customer Advances, Customer Advance, Customer Advance Liability | Phase 4 advance deposit + handout JE (liability leg)      |
| `account/accounts-receivable`      | Account   | Accounts Receivable, Accounts Receivable (A/R), A/R             | Phase 4 bank-card / PSO-card deposit JE (asset leg)       |
| `account/accounts-payable`         | Account   | Accounts Payable, Accounts Payable (A/P), A/P                   | Phase 5 PSO top-up JE (liability leg to PSO)              |
| `vendor/pso-vendor`                | Vendor    | PSO, Pakistan State Oil, Pakistan State Oil Ltd                 | Phase 5 PSO top-up JE (A/P EntityRef)                     |
| `customer/bank-card-receivable`    | Customer  | Bank Card Receivable, Bank Card Receivables                     | Phase 4 bank-card deposit + fuel sale S4-S6               |
| `customer/pso-card-receivable`     | Customer  | PSO Card Receivable, PSO Card Receivables                       | Phase 4 pso-card deposit + fuel sale S7                   |
| `bank_account/cash` *(verify-only)*| Account   | Cash in Hand, Cash on Hand, Cash                                | All phases — cash drawer (precondition from prior sprint) |

Expense accounts (17 of them) are also verified: the bootstrap confirms
each `ExpenseAccount.qbAccountName` exists in QB. The expense handler
looks these up by name at post time and does not use a mapping row.

## Usage

Runs inside the backend container so it can reuse the compiled
`dist/` modules (token refresh + entity mapping service) — same
pattern as `scripts/qb_verify_pso_test.js`.

```bash
# 1. Copy script into the container
docker cp scripts/qb_bootstrap_mappings.js kuwaitpos-backend:/tmp/qbb.js

# 2. Dry-run first — plans everything, writes nothing
docker exec kuwaitpos-backend node /tmp/qbb.js --dry-run

# 3. After dry-run looks clean, run live
docker exec kuwaitpos-backend node /tmp/qbb.js

# Optional: target a specific organization (default = first active QB connection)
docker exec kuwaitpos-backend node /tmp/qbb.js --org=9bcb8674-9d93-4d93-b0fc-270305dcbe50
```

## Output

Three sections:

1. **Required mappings** — each row prints one of:
   - `OK    <key> qbId=<id>  (already mapped)` — no action
   - `NEW   <key> -> qbId=<id>  (<qbName>)` — just created (live only)
   - `WOULD <key> -> qbId=<id>` — planned (dry-run only)
   - `MISS  <key> not found in QB` — admin must create in QB, rerun
   - `MISS  <key> (verify-only precondition)` — seed from prior sprint missing

2. **Expense accounts verification** — one line per active
   `ExpenseAccount` row. `OK`/`MISS`/`SKIP` (no qbAccountName set).

3. **Summary** — totals + an `ACTION REQUIRED` list if anything is
   missing in QB.

A machine-readable block follows marked between `---JSON-SUMMARY---`
and `---END-JSON-SUMMARY---` containing the full decision data for
automation / PR evidence.

## Exit codes

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | All mappings created or already present; all expense accounts found in QB.            |
| 2    | One or more QB entities missing — create them in QB, then rerun.                      |
| 1    | Fatal error (no active QB connection, token refresh failure, QB API unreachable, …).  |

## Safety

- **Idempotent**: rerunning the script is a no-op for mappings that
  already resolve. `upsertMapping` updates `qbId`/`qbName` if the QB
  side was renamed; history is captured when a `batchId` is supplied
  (not supplied here — bootstrap is an admin-level operation, not an
  end-user mapping edit).
- **Dry-run first**: always run `--dry-run` before a live run. It
  performs the same QB lookups and reports the plan without touching
  `qb_entity_mappings`.
- **No QB writes**: this script only *reads* from QB. It never creates
  accounts/customers/vendors in QuickBooks — those must be created in
  QB by the accountant using QB's own UI.

## Troubleshooting

- **`FATAL: no active QB connection`** — the organization has no row
  in `qb_connections` with `is_active = true`. Complete the OAuth
  hand-off first (Admin → QuickBooks → Connect).
- **`Missing mapping: bank_account/cash`** — the `verify-only`
  precondition failed. This mapping is seeded by the initial QB setup
  sprint. Inspect with:
  ```bash
  docker exec kuwaitpos-postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "
    SELECT entity_type, local_id, qb_id, qb_name, is_active
    FROM qb_entity_mappings
    WHERE entity_type = '\''bank_account'\'' AND local_id = '\''cash'\'';"'
  ```
- **Expense account NOT FOUND IN QB** — the QB account name in the
  local `expense_accounts.qb_account_name` column doesn't match what's
  in QB. Either rename the QB account to match or update the local row
  (and rerun bootstrap).
