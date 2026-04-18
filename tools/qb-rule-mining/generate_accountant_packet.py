#!/usr/bin/env python3
"""
Generate accountant review packet:
- Markdown summary
- CSV for rule approvals
- Unresolved cases
- Top outliers
"""

import json
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List
import csv

# ============================================================================
# Configuration
# ============================================================================

logger = logging.getLogger(__name__)

class AccountantPacketGenerator:
    """Generate structured review outputs for accountant approval."""

    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.output_dir = run_dir / "accountant_packet"
        self.data_dir = run_dir / "normalized_data"
        self.rules_dir = run_dir / "posting_rules"
        self.workflows_dir = run_dir / "workflows"

        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.accounts = {}
        self.transactions = {}
        self.impacts = []
        self.rules = []
        self.workflows = []

    def load_data(self):
        """Load all normalized data."""
        logger.info("Loading data for accountant packet...")

        # Accounts
        accounts_file = self.data_dir / "accounts.csv"
        if accounts_file.exists():
            with open(accounts_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.accounts[row['account_id']] = row

        # Transactions
        txn_file = self.data_dir / "transactions.csv"
        if txn_file.exists():
            with open(txn_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.transactions[row['txn_id']] = row

        # Impacts
        impacts_file = self.data_dir / "account_impacts.csv"
        if impacts_file.exists():
            with open(impacts_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    row['debit_amount'] = float(row['debit_amount'] or 0)
                    row['credit_amount'] = float(row['credit_amount'] or 0)
                    self.impacts.append(row)

        # Rules
        rules_file = self.rules_dir / "inferred_rules.csv"
        if rules_file.exists():
            with open(rules_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.rules.append(row)

        # Workflows
        wf_file = self.workflows_dir / "workflows.json"
        if wf_file.exists():
            with open(wf_file) as f:
                self.workflows = json.load(f)

        logger.info(f"  ✓ Loaded {len(self.accounts)} accounts")
        logger.info(f"  ✓ Loaded {len(self.transactions)} transactions")
        logger.info(f"  ✓ Loaded {len(self.impacts)} impacts")
        logger.info(f"  ✓ Loaded {len(self.rules)} rules")
        logger.info(f"  ✓ Loaded {len(self.workflows)} workflows")

    def generate_markdown_summary(self):
        """Generate executive summary markdown."""
        logger.info("Generating markdown summary...")

        date_str = datetime.now().isoformat(timespec='seconds')
        packet_file = self.output_dir / f"ACCOUNTANT_REVIEW_PACKET_{date_str.split('T')[0]}.md"

        # Analyze data
        txn_by_type = {}
        for txn in self.transactions.values():
            txn_type = txn['txn_type']
            txn_by_type[txn_type] = txn_by_type.get(txn_type, 0) + 1

        account_by_type = {}
        for account in self.accounts.values():
            acc_type = account['account_type']
            account_by_type[acc_type] = account_by_type.get(acc_type, 0) + 1

        # Top accounts by impact
        account_impact_count = {}
        for impact in self.impacts:
            acc_id = impact['account_id']
            account_impact_count[acc_id] = account_impact_count.get(acc_id, 0) + 1

        top_accounts = sorted(account_impact_count.items(), key=lambda x: x[1], reverse=True)[:10]

        # Coverage metrics
        classified_txns = len(set([wf['related_txn_ids'].split(',')[0] for wf in self.workflows if wf['related_txn_ids']]))
        classified_pct = (classified_txns / len(self.transactions) * 100) if self.transactions else 0

        # Build markdown
        md = f"""# QB Rule Mining Accountant Review Packet

**Generated**: {date_str}
**Review Window**: 2025-04-18 to 2026-04-18
**Run ID**: {self.run_dir.name}

---

## Executive Summary

This packet contains analysis of QuickBooks transaction data extracted for 1-year review window.
The analysis reconstructs posting workflows and infers candidate posting rules for accountant approval.

**Key Finding**: {classified_txns} of {len(self.transactions)} transactions are classified into identified workflows ({classified_pct:.1f}% coverage).

---

## Data Extraction Overview

### Record Counts
- **Accounts**: {len(self.accounts)}
- **Transactions**: {len(self.transactions)}
- **Account Impacts**: {len(self.impacts)}
- **Workflows Detected**: {len(self.workflows)}
- **Posting Rules Inferred**: {len(self.rules)}

### Transactions by Type
"""

        for txn_type in sorted(txn_by_type.keys()):
            md += f"- {txn_type}: {txn_by_type[txn_type]}\n"

        md += f"""
### Accounts by Type
"""

        for acc_type in sorted(account_by_type.keys()):
            md += f"- {acc_type}: {account_by_type[acc_type]}\n"

        md += f"""
---

## Top Accounts by Activity

Most frequently affected in transaction postings:

| Account ID | Name | Impact Count |
|-----------|------|--------------|
"""

        for acc_id, count in top_accounts:
            acc_name = self.accounts.get(acc_id, {}).get('account_name', '???')
            md += f"| {acc_id} | {acc_name} | {count} |\n"

        md += f"""
---

## Workflow Analysis

### Detected Workflow Types
"""

        by_type = {}
        for wf in self.workflows:
            wf_type = wf['trigger_type']
            if wf_type not in by_type:
                by_type[wf_type] = {'count': 0, 'amount': 0.0}
            by_type[wf_type]['count'] += 1
            by_type[wf_type]['amount'] += float(wf['total_amount'])

        for wf_type in sorted(by_type.keys()):
            md += f"- **{wf_type}**: {by_type[wf_type]['count']} workflows, ${by_type[wf_type]['amount']:.2f} total\n"

        md += f"""
---

## Posting Rules Summary

{len(self.rules)} candidate posting rules have been inferred from transaction patterns.

**Confidence Scoring**: Each rule includes:
- **Trigger Condition**: When rule applies (e.g., transaction type, customer)
- **Expected Debits**: Accounts expected to receive debits
- **Expected Credits**: Accounts expected to receive credits
- **Support Count**: Number of transactions matching pattern
- **Consistency %**: Percentage of transactions that follow exact pattern
- **Confidence Score**: 0-1 rating based on support and pattern clarity

---

## Accountant Review Checklist

### For Each Rule

☐ Verify trigger condition matches business process
☐ Confirm expected debit accounts are correct
☐ Confirm expected credit accounts are correct
☐ Review sample transactions to validate pattern
☐ Check consistency % (>80% recommended for production)
☐ Verify confidence score is acceptable
☐ Document any exceptions or special cases
☐ Approve or Reject rule

### For Complete Analysis

☐ Workflow patterns match business processes
☐ Account hierarchy correctly represents organizational structure
☐ Transaction coverage is sufficient (>80% recommended)
☐ High-value transactions are classified
☐ No unexpected account relationships detected
☐ All locked decisions from mapping are respected

---

## Next Steps

1. **Review Rules**: Open `candidate_rules.csv` and mark Approved/Rejected for each rule
2. **Address Outliers**: Review `top_outliers.csv` and determine if exceptions need new rules
3. **Resolve Cases**: Investigate `unresolved_cases.csv` for transactions that don't fit patterns
4. **Sign-Off**: Once approved, rules will be locked for automated QB sync enforcement
5. **Dry-Run**: Backend will validate posting intent against approved rules before any QB sync

---

## Attachments

- `candidate_rules.csv` - Full rule list with approval checkboxes
- `unresolved_cases.csv` - Transactions not matching any rule
- `top_outliers.csv` - Edge cases and exceptions
- `html/index.html` - Interactive dashboard (open in browser)

---

**Status**: ⏳ **AWAITING ACCOUNTANT REVIEW**

Please confirm your review completion and approval/rejection decisions via the CSV approval checklist.
"""

        with open(packet_file, 'w', encoding='utf-8') as f:
            f.write(md)

        logger.info(f"  ✓ {packet_file.name}")
        return packet_file

    def generate_rules_csv(self):
        """Generate rules with approval checkboxes."""
        logger.info("Generating rules CSV...")

        rules_file = self.output_dir / "candidate_rules.csv"

        fieldnames = [
            'rule_id', 'trigger_conditions', 'expected_debits', 'expected_credits',
            'support_count', 'consistency_pct', 'confidence_score',
            'approved', 'rejection_reason', 'notes', 'locked'
        ]

        with open(rules_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for rule in sorted(self.rules, key=lambda x: x['confidence_score'], reverse=True):
                writer.writerow({
                    'rule_id': rule['rule_id'],
                    'trigger_conditions': rule['trigger_conditions'],
                    'expected_debits': rule['expected_debits'],
                    'expected_credits': rule['expected_credits'],
                    'support_count': rule['support_count'],
                    'consistency_pct': rule['consistency_pct'],
                    'confidence_score': rule['confidence_score'],
                    'approved': '',  # Leave blank for accountant to fill
                    'rejection_reason': '',
                    'notes': '',
                    'locked': rule['locked']
                })

        logger.info(f"  ✓ {rules_file.name}: {len(self.rules)} rules")

    def generate_unresolved_cases(self):
        """Generate list of transactions not matching any workflow."""
        logger.info("Generating unresolved cases...")

        unresolved_file = self.output_dir / "unresolved_cases.csv"

        # Find transactions not in any workflow
        workflow_txn_ids = set()
        for wf in self.workflows:
            for txn_id in wf['related_txn_ids'].split(','):
                workflow_txn_ids.add(txn_id.strip())

        unresolved = [txn for txn_id, txn in self.transactions.items() if txn_id not in workflow_txn_ids]

        fieldnames = ['txn_id', 'txn_type', 'txn_date', 'doc_number', 'amount_total', 'notes']

        with open(unresolved_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for txn in sorted(unresolved, key=lambda x: x['txn_date']):
                writer.writerow({
                    'txn_id': txn['txn_id'],
                    'txn_type': txn['txn_type'],
                    'txn_date': txn['txn_date'],
                    'doc_number': txn['doc_number'],
                    'amount_total': txn['amount_total'],
                    'notes': ''  # For accountant to fill with resolution
                })

        logger.info(f"  ✓ {unresolved_file.name}: {len(unresolved)} unresolved")

    def generate_top_outliers(self):
        """Generate outlier transactions (high amount, unusual patterns)."""
        logger.info("Generating outlier report...")

        outliers_file = self.output_dir / "top_outliers.csv"

        # Find outliers: high amounts, unusual account combinations, etc.
        outliers = []

        # High-amount outliers
        amounts = sorted(self.transactions.values(), key=lambda x: float(x['amount_total']), reverse=True)
        for txn in amounts[:20]:
            outliers.append({
                'txn_id': txn['txn_id'],
                'txn_type': txn['txn_type'],
                'txn_date': txn['txn_date'],
                'amount': float(txn['amount_total']),
                'reason': 'High transaction amount',
                'notes': ''
            })

        fieldnames = ['txn_id', 'txn_type', 'txn_date', 'amount', 'reason', 'notes']

        with open(outliers_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for outlier in outliers:
                writer.writerow(outlier)

        logger.info(f"  ✓ {outliers_file.name}: {len(outliers)} outliers")

def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_accountant_packet.py <run_dir>")
        sys.exit(1)

    run_dir = Path(sys.argv[1])

    logger_obj = logging.getLogger(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(run_dir / "accountant_packet.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )

    logger_obj.info("=" * 80)
    logger_obj.info("ACCOUNTANT PACKET GENERATION")
    logger_obj.info(f"Output: {run_dir / 'accountant_packet'}")
    logger_obj.info("=" * 80)

    generator = AccountantPacketGenerator(run_dir)

    try:
        generator.load_data()
        generator.generate_markdown_summary()
        generator.generate_rules_csv()
        generator.generate_unresolved_cases()
        generator.generate_top_outliers()

        logger_obj.info("\n" + "=" * 80)
        logger_obj.info("ACCOUNTANT PACKET COMPLETE")
        logger_obj.info(f"Output: {generator.output_dir}")
        logger_obj.info("=" * 80)

        logger_obj.info(f"\nNext: python validate_outputs.py {run_dir}")

        return 0

    except Exception as e:
        logger_obj.error(f"Packet generation failed: {str(e)}")
        import traceback
        logger_obj.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    import os
    sys.exit(main())
