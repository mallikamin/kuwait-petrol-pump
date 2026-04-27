# QuickBooks Reference (Kuwait Petrol Pump POS)

Source-of-truth spreadsheets exported from the client's live QuickBooks
Online realm. Treat these as the **canonical authority** when designing
or reviewing QB-related code paths — if our `qb_entity_mappings` table,
seed scripts, or handler logic disagree with what's here, the code is
wrong, not the spreadsheet.

| File | Source | What it contains |
|------|--------|------------------|
| `POS-QB Mapping.xlsx` | client (POS workbook) | The accountant's mapping bible — every POS event (S1..S11) → QB account double-entry rules with debits/credits and example narrations. Use this when adding a new sync flow or changing an existing handler. |
| `QuickBooks Entities.xlsx` | extracted from QB | Snapshot of the client's full QB COA + customer + item + payment-method lists with QB IDs. Use this to cross-check `qb_entity_mappings` rows when investigating "missing in QB" or "wrong mapping" claims. |

## When to consult these

- **Before** adding/altering a QB handler.
- **Before** writing or running a seed against a new tenant.
- **When** a sync error claims an entity is "missing" in QB — confirm
  here first to rule out a discovery-script false negative.
- **When** an account name/ID changes in QB and the integration starts
  failing — confirm the new ID against the live QB before touching
  `qb_entity_mappings` directly.

## Last reconciliation

- 2026-04-27 — Demo Petrol Pump POS realm `9341456151251934`. 4 missing
  customer mappings bound (AL-MUKHTAR FLOUR / ALLMED / KANSAI PAINT /
  PHARMA SOLE → QB ids 6/11/41/52). Loss-expense accounts confirmed
  moved from COGS to Other Expense (`hsd-loss-expense → 1150040007`,
  `pmg-loss-expense → 1150040008`). All 12 dip-variance JEs reconciled
  to correct TxnDates per `business_date`.

## Refresh policy

These are point-in-time exports. Re-export and overwrite when:
- Accountant restructures the COA (e.g. moves accounts between parents).
- New customers / items / banks are added.
- Onboarding a new tenant — capture their realm's exports here as
  `<tenant>-POS-QB Mapping.xlsx` etc.
