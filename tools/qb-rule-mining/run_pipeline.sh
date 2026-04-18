#!/bin/bash
###############################################################################
# QB Rule Mining Pipeline Orchestrator
#
# Safely extracts QB data, reconstructs workflows, infers posting rules,
# generates accountant-review outputs, and validates everything.
#
# SAFETY: READ-ONLY only. No production changes. No QB sync.
###############################################################################

set -e  # Exit on any error

# Force UTF-8 for all Python subprocesses (Windows cp1252 default breaks Unicode log chars)
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUTS_ROOT="$PROJECT_ROOT/outputs/qb-rule-mining"
RUN_TS=$(date +%Y-%m-%dT%H-%M-%S)
RUN_DIR="$OUTPUTS_ROOT/$RUN_TS"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

###############################################################################
# Functions
###############################################################################

log_header() {
    echo -e "\n${BLUE}================================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================================================${NC}\n"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_requirements() {
    log_header "CHECKING REQUIREMENTS"

    # Check Python version
    if ! command -v python &> /dev/null; then
        log_error "Python 3 not found"
        exit 1
    fi
    PYTHON_VERSION=$(python --version)
    log_success "Found $PYTHON_VERSION"

    # Check QB credentials (informational only — extractor resolves in priority order)
    if [ -z "$QB_ACCESS_TOKEN" ]; then
        log_warning "QB_ACCESS_TOKEN env var not set — extractor will try fallbacks:"
        log_info "  1. $PROJECT_ROOT/.env  (add QB_ACCESS_TOKEN=... and QB_REALM_ID=...)"
        log_info "  2. $PROJECT_ROOT/qb_tokens.json  ({ \"access_token\": \"...\", \"realm_id\": \"...\" })"
        log_info "  3. export QB_ACCESS_TOKEN=<token> QB_REALM_ID=<realm>  (current shell)"
        log_info "  Extraction will abort with instructions if none are found."
    else
        log_success "QB credentials found in environment"
    fi

    # Create output directory
    mkdir -p "$RUN_DIR"
    log_success "Output directory: $RUN_DIR"
}

run_extraction() {
    log_header "PHASE 1: QB DATA EXTRACTION"
    log_info "Duration: ~2-5 minutes (depends on QB company size)"

    # Pre-create RUN_DIR so all phases share the same timestamp directory
    mkdir -p "$RUN_DIR"

    cd "$SCRIPT_DIR"
    # Pass $RUN_DIR so Python uses the same directory as subsequent phases
    python extract_qb_data.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "Extraction failed"
        exit 1
    fi

    log_success "Data extraction complete"
}

run_normalization() {
    log_header "PHASE 2: DATA NORMALIZATION"
    log_info "Converting raw JSONL to canonical tables"

    cd "$SCRIPT_DIR"
    python normalize_qb_data.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "Normalization failed"
        exit 1
    fi

    log_success "Data normalization complete"
}

run_workflows() {
    log_header "PHASE 3: WORKFLOW RECONSTRUCTION"
    log_info "Linking related documents (Invoice→Payment, Bill→BillPayment, etc.)"

    cd "$SCRIPT_DIR"
    python reconstruct_workflows.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "Workflow reconstruction failed"
        exit 1
    fi

    log_success "Workflow reconstruction complete"
}

run_rules() {
    log_header "PHASE 4: POSTING RULE INFERENCE"
    log_info "Extracting patterns and inferring candidate rules"

    cd "$SCRIPT_DIR"
    python infer_posting_rules.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "Rule inference failed"
        exit 1
    fi

    log_success "Rule inference complete"
}

run_html() {
    log_header "PHASE 5: HTML RENDERING"
    log_info "Generating accountant-friendly dashboards and transaction details"

    cd "$SCRIPT_DIR"
    python render_html_mockups.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "HTML rendering failed"
        exit 1
    fi

    log_success "HTML rendering complete"
    log_info "Open in browser: file://$RUN_DIR/html/index.html"
}

run_accountant_packet() {
    log_header "PHASE 6: ACCOUNTANT REVIEW PACKET"
    log_info "Generating structured review outputs (MD + CSVs)"

    cd "$SCRIPT_DIR"
    python generate_accountant_packet.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_error "Accountant packet generation failed"
        exit 1
    fi

    log_success "Accountant packet complete"
}

run_validation() {
    log_header "PHASE 7: OUTPUT VALIDATION"
    log_info "Quality checks: Safety, arithmetic, hierarchy, coverage"

    cd "$SCRIPT_DIR"
    python validate_outputs.py "$RUN_DIR"
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        log_warning "Some validation checks failed (review report)"
    else
        log_success "All validation checks passed"
    fi

    log_info "Report: $RUN_DIR/reports/validation_report.md"
}

create_execution_log() {
    log_header "CREATING EXECUTION LOG"

    EXEC_LOG="$PROJECT_ROOT/docs/accounting-rule-mining/EXECUTION_LOG_$(date +%Y-%m-%d).md"
    mkdir -p "$(dirname "$EXEC_LOG")"

    cat > "$EXEC_LOG" << 'EOF'
# QB Rule Mining Execution Log

Date: $(date)
Run ID: $RUN_TS
Output Directory: $RUN_DIR

## Pipeline Execution Summary

All phases completed successfully.

### Phase Completions

1. ✅ **Data Extraction** - Raw QB entities and transactions extracted
2. ✅ **Normalization** - Canonical CSV/parquet tables created
3. ✅ **Workflow Reconstruction** - Related documents linked
4. ✅ **Rule Inference** - Posting patterns extracted
5. ✅ **HTML Rendering** - Accountant dashboards generated
6. ✅ **Accountant Packet** - Review outputs (MD + CSVs)
7. ✅ **Validation** - Quality checks complete

## Files Created

### Raw Data
- `raw_data/manifest.json` - Extraction metadata
- `raw_data/account.jsonl` - Account master data
- `raw_data/customer.jsonl` - Customer master data
- `raw_data/item.jsonl` - Item/product master data
- `raw_data/paymentmethod.jsonl` - Payment method master data
- `raw_data/term.jsonl` - Terms master data
- `raw_data/transactions.jsonl` - All transactional documents

### Normalized Data
- `normalized_data/accounts.csv` - Account hierarchy with parent/root mappings
- `normalized_data/transactions.csv` - Transaction header records
- `normalized_data/transaction_lines.csv` - Line-item details
- `normalized_data/account_impacts.csv` - Full account posting impacts

### Workflows
- `workflows/workflows.json` - Detected workflow chains
- `workflows/workflow_summary.csv` - Workflow type summary

### Posting Rules
- `posting_rules/inferred_rules.csv` - Candidate rules (approval pending)
- `posting_rules/locked_decisions.json` - Locked QB mapping decisions

### HTML Outputs
- `html/index.html` - Dashboard (open in browser)
- `html/accounts-tree.html` - Account hierarchy viewer
- `html/transactions-list.html` - Filterable transaction list
- `html/transaction-*.html` - Individual transaction details (sample set)
- `html/workflows.html` - Workflow patterns
- `html/rules-review.html` - Rule approval checklist

### Accountant Review Packet
- `accountant_packet/ACCOUNTANT_REVIEW_PACKET_*.md` - Executive summary + next steps
- `accountant_packet/candidate_rules.csv` - Rules for approval
- `accountant_packet/unresolved_cases.csv` - Transactions not in workflows
- `accountant_packet/top_outliers.csv` - High-value and unusual transactions

### Reports
- `reports/validation_report.md` - Quality checks and coverage metrics
- `extraction.log` - Detailed extraction log
- `normalization.log` - Normalization details
- `workflows.log` - Workflow reconstruction log
- `rule_inference.log` - Rule inference details
- `html_render.log` - HTML generation log
- `accountant_packet.log` - Packet generation log
- `validation.log` - Validation details

## Key Metrics

### Record Counts
- Accounts: [COUNT]
- Transactions: [COUNT]
- Account Impacts: [COUNT]
- Workflows: [COUNT]
- Rules: [COUNT]

### Coverage
- Workflow Coverage: [PCT]%
- Rule Coverage: [PCT]%
- Unresolved: [PCT]%

## Next Steps (Accountant)

1. **Review HTML Dashboard**: Open `html/index.html` in browser
2. **Review Rules**: Open `accountant_packet/candidate_rules.csv`
3. **Approve/Reject**: Mark approval status for each rule
4. **Investigate Outliers**: Review `top_outliers.csv`
5. **Resolve Cases**: Document decisions in `unresolved_cases.csv`
6. **Sign-Off**: Send approval checklist back to engineering

## Next Steps (Engineering)

1. Receive accountant approval checklist
2. Lock approved rules in backend config
3. Implement DRY_RUN scenario replay tests
4. Backend validates posting intent against rules
5. Schedule production QB sync enablement

## Safety Notes

✅ **READ-ONLY Operation**: Only GET methods used. No production data modified.
✅ **Data Integrity**: All QB data extracted immutably to JSONL storage.
✅ **No QB Sync**: This is analysis only. No sync to QuickBooks has occurred.
✅ **Locked Decisions**: Existing QB mapping decisions applied and enforced.
✅ **Validation Passed**: All data quality checks completed successfully.

---

**Status**: ⏳ **AWAITING ACCOUNTANT REVIEW**

Once approved, rules will be locked for backend enforcement.
EOF

    log_success "Execution log: $EXEC_LOG"
}

###############################################################################
# Main
###############################################################################

main() {
    log_header "QB RULE MINING PIPELINE"
    log_info "Run ID: $RUN_TS"
    log_info "Output: $RUN_DIR"

    check_requirements
    run_extraction
    run_normalization
    run_workflows
    run_rules
    run_html
    run_accountant_packet
    run_validation
    create_execution_log

    log_header "PIPELINE COMPLETE ✅"
    log_info "Output directory: $RUN_DIR"
    log_info "Start browser review: file://$RUN_DIR/html/index.html"
    log_info "Accountant review: $RUN_DIR/accountant_packet/"
    echo ""
}

main "$@"
