# Claude Task Brief - QB Mapping + Sync Alignment (QB Data Safety First)

Date: 2026-04-17
Execution mode: Review-first (do not apply until approval)

## Required Inputs
- `docs/client-feedback/QuickBooks Entities - Client Feedback 2026-04-17.xlsx`
- `docs/client-feedback/QB_SAFE_TEST_RUNBOOK_2026-04-17.md`

## First Step (Mandatory)
Take QB snapshot bundle (not POS DB backup):
- Accounts, Customers, Items, Payment Methods, Terms exports
- Current mapping export
- Controls/safety-gates JSON export
Save under `docs/client-feedback/snapshots/<timestamp>/`.

## Safety Mode
- Use production realm.
- Run validation in `DRY_RUN` mode first.
- No real writes before approval.

## Locked Decisions
- cash => QB account `90`
- exclude petty cash account `93`
- card/bank -> directly selected bank account (`88/89/91/92`)
- add COGS keys: `cogs_hsd`, `cogs_pmg`, `cogs_nonfuel`
- walk-in = SalesReceipt only, customer `71`, cash account `90`
- non-fuel income => account `82`
- block parent posting heads `79`, `83`, `87`

## Deliverables
1. Snapshot manifest with file list
2. Proposed mapping matrix (100% target)
3. DRY_RUN evidence for transaction-flow correctness
4. Any unresolved blockers/questions only
