# QB Rule Mining Pipeline

READ-ONLY analysis of QuickBooks data to extract posting rules and transaction workflows.

## Safety First
- **HTTP Verb Enforcement**: GET only (fails fast on POST/PUT/DELETE)
- **No Production Changes**: Analysis only, no sync modifications
- **Immutable Output**: All data read once and stored in outputs folder

## Scripts

1. **extract_qb_data.py** - Pull QB data with manifest
2. **normalize_qb_data.py** - Normalize to CSV/parquet with account hierarchy
3. **reconstruct_workflows.py** - Link related documents
4. **infer_posting_rules.py** - Extract posting patterns from transactions
5. **render_html_mockups.py** - Static HTML for accountant review
6. **generate_accountant_packet.py** - Structured output (MD + CSVs)
7. **validate_outputs.py** - Data quality + safety checks

## Locked QB Mapping Decisions
- cash => account 90
- Exclude petty cash 93
- Card/bank -> 88/89/91/92
- COGS: cogs_hsd, cogs_pmg, cogs_nonfuel
- Walk-in = SalesReceipt, customer 71, cash 90
- Non-fuel income => 82
- Block parent posting heads: 79, 83, 87

## Date Window
- start_date: 2025-04-18
- end_date: 2026-04-18
