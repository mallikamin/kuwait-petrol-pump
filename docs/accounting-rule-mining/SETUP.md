# QB Rule Mining Pipeline Setup

READ-ONLY analysis pipeline for extracting QB posting rules and transaction workflows.

## Overview

This pipeline safely extracts 1 year of QuickBooks data, reconstructs transaction workflows, infers posting rules, and generates outputs for accountant review.

**Safety First**:
- ✅ GET-only (no writes to QB)
- ✅ Immutable JSONL storage
- ✅ No production behavior changes
- ✅ Validation before any rule use

## Prerequisites

- Python 3.8+
- QB Access Token (from QBConnection table)
- QB Realm ID (company ID)

## Setup

### 1. Get QB Credentials

```bash
# From backend service, decrypt and export
export QB_ACCESS_TOKEN="<access_token_from_qb_connection>"
export QB_REALM_ID="<realm_id>"
export QB_API_BASE_URL="https://quickbooks.api.intuit.com"
```

### 2. Run Pipeline

```bash
cd tools/qb-rule-mining/

# Full pipeline (7 phases, ~10-20 minutes)
bash run_pipeline.sh

# Individual phases
python3 extract_qb_data.py
python3 normalize_qb_data.py <run_dir>
python3 reconstruct_workflows.py <run_dir>
python3 infer_posting_rules.py <run_dir>
python3 render_html_mockups.py <run_dir>
python3 generate_accountant_packet.py <run_dir>
python3 validate_outputs.py <run_dir>
```

## Pipeline Phases

### Phase 1: Data Extraction
Pulls QB entities and transactions (2025-04-18 to 2026-04-18) via read-only API.

**Outputs**:
- `raw_data/manifest.json` - Extraction metadata
- `raw_data/*.jsonl` - Immutable entity/transaction data

**Safety**: GET-only HTTP enforced. Fails fast on write attempts.

### Phase 2: Normalization
Converts raw JSONL to CSV with account hierarchy and posting impacts.

**Outputs**:
- `normalized_data/accounts.csv` - Full hierarchy
- `normalized_data/transactions.csv` - Header records
- `normalized_data/account_impacts.csv` - Posting details

### Phase 3: Workflow Reconstruction
Links related documents (Invoice→Payment, Bill→BillPayment, deposits).

**Outputs**:
- `workflows/workflows.json` - Detected chains
- `workflows/workflow_summary.csv` - Type summary

### Phase 4: Rule Inference
Extracts posting patterns and infers candidate rules.

**Outputs**:
- `posting_rules/inferred_rules.csv` - Rules (pending approval)
- `posting_rules/locked_decisions.json` - Locked mapping decisions

### Phase 5: HTML Rendering
Generates accountant-friendly dashboards.

**Outputs**:
- `html/index.html` - Dashboard
- `html/accounts-tree.html` - Hierarchy viewer
- `html/transactions-list.html` - Transaction list
- `html/transaction-*.html` - Details (samples)
- `html/workflows.html` - Workflow patterns
- `html/rules-review.html` - Rule checklist

### Phase 6: Accountant Packet
Structured review outputs.

**Outputs**:
- `accountant_packet/ACCOUNTANT_REVIEW_PACKET_*.md` - Executive summary
- `accountant_packet/candidate_rules.csv` - Rules for approval
- `accountant_packet/unresolved_cases.csv` - Unclassified transactions
- `accountant_packet/top_outliers.csv` - Edge cases

### Phase 7: Validation
Quality checks and coverage metrics.

**Outputs**:
- `VALIDATION_REPORT.md` - Quality summary

## Accountant Workflow

1. **Review HTML Dashboard**
   - `html/index.html` in browser
   - Browse transactions and workflows

2. **Review Rules**
   - `accountant_packet/candidate_rules.csv`
   - Check trigger conditions, expected debits/credits
   - Mark Approved/Rejected

3. **Investigate Outliers**
   - `accountant_packet/top_outliers.csv`
   - Document decisions in "notes" column

4. **Resolve Unclassified**
   - `accountant_packet/unresolved_cases.csv`
   - Decide: new rule or exception?

5. **Sign-Off**
   - Complete approval checklist
   - Send back to engineering

## Engineering Follow-Up

Once approved:

1. Load approved rules into backend config
2. Implement DRY_RUN scenario tests
3. Backend validates posting intent against rules
4. Production QB sync readiness gates

## Key Files

### Scripts
- `extract_qb_data.py` - QB extraction (GET-only)
- `normalize_qb_data.py` - Canonicalize to CSV
- `reconstruct_workflows.py` - Link documents
- `infer_posting_rules.py` - Extract patterns
- `render_html_mockups.py` - Generate HTML
- `generate_accountant_packet.py` - Review outputs
- `validate_outputs.py` - Quality checks
- `run_pipeline.sh` - Orchestration

### Locked Decisions (in run outputs)
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

## Troubleshooting

### QB Credentials Missing
```bash
# Must set before running
export QB_ACCESS_TOKEN="token"
export QB_REALM_ID="realm"
export QB_API_BASE_URL="https://quickbooks.api.intuit.com"
```

### Extraction Timeout
- QB company may be large
- Increase timeout in `extract_qb_data.py` (line ~87)
- Run overnight for large datasets

### Debit/Credit Imbalance
- Review in `VALIDATION_REPORT.md`
- Most common: QB has complex multi-leg transactions
- Not a blocker; accountant decides handling

### Low Coverage (<80%)
- Some workflows may be custom
- Review unresolved in accountant packet
- Add new rules as needed

## Safety Enforcement

1. **HTTP Verb Allowlist**: All requests enforced to GET only
2. **Immutable Storage**: Raw JSONL never modified
3. **Validation Gates**: Quality checks before outputs
4. **Locked Decisions**: Existing mapping applied automatically
5. **No Production Changes**: Analysis only, no sync enabled

## Performance Notes

- **Extraction**: 2-5 min (depends on QB company size)
- **Normalization**: <1 min
- **Workflows**: <1 min
- **Rules**: <1 min
- **HTML Rendering**: <1 min
- **Validation**: <1 min
- **Total**: ~10-20 minutes

## Next: Execution

```bash
cd tools/qb-rule-mining/
bash run_pipeline.sh
```

Follow on-screen prompts. Output directory will be printed at completion.
