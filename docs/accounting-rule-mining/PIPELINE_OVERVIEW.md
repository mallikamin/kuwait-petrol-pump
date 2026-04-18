# QB Rule Mining Pipeline Overview

## Purpose

Build a **READ-ONLY** QuickBooks analysis system that:
1. Safely extracts 1 year of QB data (2025-04-18 to 2026-04-18)
2. Reconstructs transaction workflows and document chains
3. Infers candidate posting rules from patterns
4. Produces HTML mockups + accountant-review outputs
5. **Zero production changes** — analysis only

## Safety Architecture

### Hard Constraints
✅ **GET-only HTTP**: No POST/PUT/DELETE allowed (fails fast)
✅ **Immutable storage**: Raw data written once to JSONL
✅ **No app changes**: `apps/backend/` and `apps/web/` untouched
✅ **Isolated folders**: All work in `tools/qb-rule-mining/`, `docs/accounting-rule-mining/`, `outputs/qb-rule-mining/`
✅ **No deploy**: Uses `./scripts/deploy.sh` → NOT invoked
✅ **Locked decisions**: Existing QB mapping rules applied automatically

### Validation Gates
- Debit/credit arithmetic checks
- Account hierarchy consistency
- Impact resolution verification
- Rollup sum validation
- Coverage metrics reporting

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: EXTRACTION                                             │
│ extract_qb_data.py                                              │
│ - GET /query (accounts, customers, items, etc.)                │
│ - GET /query (transactions: Invoice, Bill, Payment, etc.)      │
│ - Output: raw_data/*.jsonl + manifest.json                     │
│ Safety: HTTP verb enforcement, timeout handling               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: NORMALIZATION                                          │
│ normalize_qb_data.py                                            │
│ - Load JSONL, build account hierarchy (parent/root/FQN)        │
│ - Extract line items, build account impacts                    │
│ - Output: *.csv (accounts, transactions, impacts, hierarchy)  │
│ Safety: No writes back to QB                                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: WORKFLOW RECONSTRUCTION                               │
│ reconstruct_workflows.py                                        │
│ - Link Invoice → Payment                                        │
│ - Link Bill → BillPayment                                       │
│ - Group Deposits, SalesReceipts, JournalEntries                │
│ - Output: workflows.json + workflow_summary.csv                │
│ Safety: Pattern matching only, no mutations                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: RULE INFERENCE                                         │
│ infer_posting_rules.py                                          │
│ - Analyze transaction patterns by type                          │
│ - Calculate support, consistency, confidence                    │
│ - Apply locked mapping decisions                                │
│ - Output: inferred_rules.csv + locked_decisions.json            │
│ Safety: No rule activation without approval                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 5: HTML RENDERING                                         │
│ render_html_mockups.py                                          │
│ - Dashboard: account stats, top accounts, quick links           │
│ - Accounts Tree: hierarchy viewer                               │
│ - Transactions List: filterable table                           │
│ - Transaction Details: posting block + impacts                 │
│ - Workflows Summary: workflow type breakdown                    │
│ - Rules Review: approval checklist                              │
│ - Output: html/ (static pages, no external CDN)                │
│ Safety: Static content, no JavaScript runtime access           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 6: ACCOUNTANT PACKET                                      │
│ generate_accountant_packet.py                                   │
│ - Executive summary (MD)                                        │
│ - Rule approval checklist (CSV)                                 │
│ - Unresolved cases (CSV)                                        │
│ - Top outliers (CSV)                                            │
│ - Output: accountant_packet/                                    │
│ Safety: Structured, auditable outputs                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 7: VALIDATION                                             │
│ validate_outputs.py                                             │
│ - Check no write methods used ✓                                 │
│ - Check account hierarchy consistency ✓                         │
│ - Check debit/credit balance ✓                                  │
│ - Check impact resolution ✓                                     │
│ - Check rollup sums ✓                                           │
│ - Calculate coverage metrics                                    │
│ - Output: VALIDATION_REPORT.md                                  │
│ Safety: Gate for data quality before release                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                     ANALYSIS COMPLETE
              (Awaiting accountant review/approval)
```

## File Structure

```
kuwait-petrol-pump/
├── tools/qb-rule-mining/
│   ├── README.md                           # Overview
│   ├── extract_qb_data.py                 # Phase 1: Extraction
│   ├── normalize_qb_data.py               # Phase 2: Normalization
│   ├── reconstruct_workflows.py           # Phase 3: Workflows
│   ├── infer_posting_rules.py             # Phase 4: Rules
│   ├── render_html_mockups.py             # Phase 5: HTML
│   ├── generate_accountant_packet.py      # Phase 6: Packet
│   ├── validate_outputs.py                # Phase 7: Validation
│   └── run_pipeline.sh                    # Orchestration
│
├── docs/accounting-rule-mining/
│   ├── SETUP.md                           # Getting started
│   ├── PIPELINE_OVERVIEW.md               # This file
│   └── EXECUTION_LOG_*.md                 # Run results
│
└── outputs/qb-rule-mining/
    └── <run_timestamp>/
        ├── raw_data/                      # Phase 1 outputs
        │   ├── manifest.json
        │   ├── account.jsonl
        │   ├── customer.jsonl
        │   ├── transactions.jsonl
        │   └── ...
        │
        ├── normalized_data/               # Phase 2 outputs
        │   ├── accounts.csv
        │   ├── transactions.csv
        │   ├── account_impacts.csv
        │   └── ...
        │
        ├── workflows/                     # Phase 3 outputs
        │   ├── workflows.json
        │   └── workflow_summary.csv
        │
        ├── posting_rules/                 # Phase 4 outputs
        │   ├── inferred_rules.csv
        │   └── locked_decisions.json
        │
        ├── html/                          # Phase 5 outputs
        │   ├── index.html
        │   ├── accounts-tree.html
        │   ├── transactions-list.html
        │   ├── transaction-*.html
        │   ├── workflows.html
        │   └── rules-review.html
        │
        ├── accountant_packet/             # Phase 6 outputs
        │   ├── ACCOUNTANT_REVIEW_PACKET_*.md
        │   ├── candidate_rules.csv
        │   ├── unresolved_cases.csv
        │   └── top_outliers.csv
        │
        ├── VALIDATION_REPORT.md           # Phase 7 outputs
        │
        └── *.log                          # Phase logs
```

## Data Models

### Account Hierarchy
```
account_id → parent_account_id → root_account_id
           → fully_qualified_name (e.g., "Assets/Bank/Checking")
           → depth (0 = root, 1 = parent, 2+ = children)
           → account_type (Asset, Liability, Equity, etc.)
```

### Account Impacts
```
txn_id → line_id → account_id
                 → parent_account_id (for rollups)
                 → root_account_id (for summary)
                 → debit_amount | credit_amount
                 → source_detail_path (e.g., "Line[0].AccountRef")
```

### Posting Rules
```
rule_id
├── trigger_conditions (e.g., "txn_type == 'Invoice'")
├── expected_debits (comma-separated account IDs)
├── expected_credits (comma-separated account IDs)
├── support_count (# transactions matching pattern)
├── consistency_pct (% exact pattern matches)
├── confidence_score (0-1 rating)
├── sample_txn_ids (examples proving rule works)
└── locked (true if part of existing mapping)
```

## Locked Mapping Decisions

Applied automatically during rule inference:

```json
{
  "cash_account": "90",
  "exclude_accounts": ["93"],
  "bank_accounts": ["88", "89", "91", "92"],
  "cogs_keys": ["cogs_hsd", "cogs_pmg", "cogs_nonfuel"],
  "walkin_customer": "71",
  "walkin_txn_type": "SalesReceipt",
  "nonfuel_income": "82",
  "block_parents": ["79", "83", "87"]
}
```

These decisions are:
- ✅ Enforced in all outputs
- ✅ Immutable (cannot be overridden by inference)
- ✅ Documented in execution logs
- ✅ Preserved for backend DRY_RUN tests

## Accountant Review Flow

```
1. RECEIVE: Execution log + HTML dashboard
   ├─ html/index.html → Open in browser
   └─ accountant_packet/ACCOUNTANT_REVIEW_PACKET_*.md → Read summary

2. REVIEW RULES
   ├─ accountant_packet/candidate_rules.csv
   ├─ Check trigger, debits, credits, confidence
   └─ Mark: Approved | Rejected | Needs Clarification

3. INVESTIGATE OUTLIERS
   ├─ accountant_packet/top_outliers.csv
   └─ Decide: Exception to rule or new rule?

4. RESOLVE UNCLASSIFIED
   ├─ accountant_packet/unresolved_cases.csv
   └─ Provide: New rule or manual handling?

5. APPROVE & SIGN-OFF
   └─ Return completed CSVs to engineering

6. ENGINEERING LOCKS RULES
   ├─ Load approved rules into backend config
   ├─ Implement DRY_RUN scenario tests
   └─ Enable production QB sync gates
```

## Key Metrics & Coverage

**Extraction Coverage**:
- % of QB entities successfully pulled
- % of date-range transactions captured

**Workflow Coverage**:
- % of transactions classified into workflow patterns
- % with related documents (Invoice→Payment, etc.)

**Rule Coverage**:
- % of account impacts covered by inferred rules
- Avg confidence score by rule type

**Quality Metrics**:
- Debit/credit balance ratio (should be 1.0)
- Account hierarchy depth (max nesting level)
- Rollup consistency (parent totals = sum of children)

**Unresolved**:
- % transactions not matching any workflow
- % impacts not covered by rules
- Outlier transactions requiring special handling

## Next: Implementation Roadmap

Once accountant approves rules:

### Backend Changes (DRY_RUN Phase)
1. Load approved rules into `posting_rules_config.json`
2. Implement `validatePostingIntent()` function
3. Scenario test suite (replay with assertions)
4. Production gate: All tests pass before QB sync

### Sync Enablement
1. Set `QB_SYNC_MODE: DRY_RUN` (read-only validation)
2. Log posting intent vs. rule matching
3. Alert on mismatches (human review gate)
4. Production approval before `WRITE_ENABLED`

### Monitoring & Alerting
1. Daily rule coverage metrics
2. Alert on low confidence matches
3. Weekly reconciliation vs. QB actual

---

## Files Ready for Use

**Today (Ready to Run)**:
- ✅ `tools/qb-rule-mining/*.py` - All 7 scripts
- ✅ `docs/accounting-rule-mining/SETUP.md` - Getting started
- ✅ `tools/qb-rule-mining/run_pipeline.sh` - Orchestration

**After First Run**:
- ✅ `outputs/qb-rule-mining/<timestamp>/*` - Analysis results
- ✅ `docs/accounting-rule-mining/EXECUTION_LOG_*.md` - Run summary

**What's NOT Changed**:
- ✅ `apps/backend/` - No production code changes
- ✅ `apps/web/` - No frontend changes
- ✅ `packages/database/` - Schema untouched
- ✅ Deployment disabled - No `./scripts/deploy.sh` calls

---

## Safety Summary

| Layer | Control | Status |
|-------|---------|--------|
| HTTP Methods | GET-only allowlist, fail-fast on writes | ✅ Enforced |
| Storage | Immutable JSONL, never overwritten | ✅ Enforced |
| Code Changes | tools + docs only, no app changes | ✅ Locked |
| Deployment | No deploy script invoked | ✅ Blocked |
| Data Validation | Debit/credit, hierarchy, rollups | ✅ Gated |
| Rule Activation | Requires accountant approval | ✅ Manual gate |
| Locked Decisions | Applied automatically, immutable | ✅ Enforced |

---

**Status**: 🟢 **READY FOR EXECUTION**

Next step: Run `bash run_pipeline.sh` in `tools/qb-rule-mining/` with QB credentials set.
