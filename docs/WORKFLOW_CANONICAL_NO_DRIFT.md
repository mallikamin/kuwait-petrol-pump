# Workflow Canonical No-Drift Contract

Last updated: 2026-04-10
Applies to: Backdated Entries, Meter Readings, Daily Reconciliation, Finalize Day

## Non-Negotiable Rules

1. Transactions are not nozzle-linked.
2. No transaction validation may depend on nozzle, nozzle fuel, or nozzle assignment.
3. Meter readings are nozzle-based input only.
4. Reconciliation is fuel-type based only:
   - HSD posted liters vs HSD meter liters
   - PMG posted liters vs PMG meter liters
5. Walk-in cash is a normal transaction entry (no placeholder nozzle behavior).
6. Finalize Day succeeds when reconciliation gates pass and must post results to sales, reports, inventory, and downstream fields.

## Operational Workflow

1. Operators enter shift-wise, nozzle-wise opening/closing readings.
2. Input modes allowed:
   - live camera OCR
   - OCR from previously taken/uploaded photo
   - manual entry with optional attachment
3. Each nozzle maps to a product/fuel type (PMG or HSD) in nozzle configuration.
4. System aggregates nozzle deltas into daily product-wise meter totals (PMG/HSD).
5. Accountant posts backdated transactions manually (credit, bank card, PSO card, etc.).
6. Accountant computes/posts remaining walk-in cash amount.
7. User presses Finalize Day.
8. System persists finalized outputs to sales tab, reports, inventory, and related accounting fields.

## Guardrails For Engineers/Agents

1. Never reintroduce per-nozzle transaction matching or nozzle-fuel mismatch blockers for transactions.
2. Keep meter-reading continuity/propagation logic independent from transaction nozzle constraints.
3. If legacy schema has nozzle references in container tables, do not use them as transaction accounting constraints.
4. Any 409 on daily save must be for genuine transaction validation conflicts, not nozzle linkage assumptions.

## Regression Checklist (Must Pass)

1. Edit existing transaction (example: 40 -> 240) saves without nozzle-related 409.
2. Add new transaction with "+" saves without nozzle-related 409.
3. Daily summary shows correct PMG/HSD posted totals against PMG/HSD meter totals.
4. Finalize Day completes and writes expected sales/reporting/inventory artifacts.
5. Reload/navigation does not mutate saved transaction fuel-type assignments.
