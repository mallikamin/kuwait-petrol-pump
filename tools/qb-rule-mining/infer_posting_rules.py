#!/usr/bin/env python3
"""
Infer candidate posting rules from transaction patterns.
Extracts repeated patterns and scores confidence based on consistency.
"""

import json
import os
import sys
import logging
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict
import csv

# ============================================================================
# Configuration
# ============================================================================

logger = logging.getLogger(__name__)

class PostingRuleInferencer:
    """Extract posting rules from transaction patterns."""

    def __init__(self, data_dir: Path, output_dir: Path):
        self.data_dir = data_dir
        self.output_dir = output_dir

        # LOCKED DECISIONS (from brief)
        self.locked_decisions = {
            'cash_account': '90',
            'exclude_accounts': ['93'],
            'bank_accounts': ['88', '89', '91', '92'],
            'cogs_keys': ['cogs_hsd', 'cogs_pmg', 'cogs_nonfuel'],
            'walkin_customer': '71',
            'walkin_txn_type': 'SalesReceipt',
            'nonfuel_income': '82',
            'block_parents': ['79', '83', '87']
        }

        # In-memory structures
        self.accounts = {}
        self.impacts = []
        self.rules = []
        self.rule_warnings = []  # low-confidence or conflicting rules

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s | %(levelname)s | %(message)s',
            handlers=[
                logging.FileHandler(output_dir / "rule_inference.log"),
                logging.StreamHandler(sys.stdout)
            ]
        )
        logger.info(f"PostingRuleInferencer initialized for {data_dir}")

    def load_data(self) -> Tuple[int, int]:
        """Load accounts and impacts."""
        logger.info("Loading normalized data...")

        # Load accounts
        accounts_file = self.data_dir / "accounts.csv"
        account_count = 0
        if accounts_file.exists():
            with open(accounts_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.accounts[row['account_id']] = row
                    account_count += 1

        # Load impacts
        impacts_file = self.data_dir / "account_impacts.csv"
        impact_count = 0
        if impacts_file.exists():
            with open(impacts_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Parse numeric fields
                    row['debit_amount'] = float(row['debit_amount'] or 0)
                    row['credit_amount'] = float(row['credit_amount'] or 0)
                    row['net_amount'] = float(row['net_amount'] or 0)
                    self.impacts.append(row)
                    impact_count += 1

        logger.info(f"  ✓ Loaded {account_count} accounts")
        logger.info(f"  ✓ Loaded {impact_count} impacts")
        return account_count, impact_count

    def infer_rules_by_txn_type(self) -> List[Dict]:
        """Infer rules based on transaction type patterns."""
        logger.info("Inferring rules by transaction type...")

        # Group impacts by transaction type
        by_txn_type = defaultdict(list)
        for impact in self.impacts:
            by_txn_type[impact['txn_type']].append(impact)

        rules = []
        rule_count = 0

        for txn_type in sorted(by_txn_type.keys()):
            impacts = by_txn_type[txn_type]

            # Analyze account patterns
            debited_accounts = defaultdict(int)
            credited_accounts = defaultdict(int)
            total_debits = 0.0
            total_credits = 0.0
            sample_txn_ids = set()

            for impact in impacts[:100]:  # Sample
                if impact['debit_amount'] > 0:
                    debited_accounts[impact['account_id']] += 1
                    total_debits += impact['debit_amount']
                if impact['credit_amount'] > 0:
                    credited_accounts[impact['account_id']] += 1
                    total_credits += impact['credit_amount']
                sample_txn_ids.add(impact['txn_id'])

            # Top accounts
            top_debits = sorted(debited_accounts.items(), key=lambda x: x[1], reverse=True)[:3]
            top_credits = sorted(credited_accounts.items(), key=lambda x: x[1], reverse=True)[:3]

            if top_debits or top_credits:
                confidence = self._calc_confidence(len(impacts), top_debits, top_credits)
                consistency = self._calc_consistency(impacts)
                rule = {
                    'rule_id': f"rule_{txn_type.lower()}_001",
                    'trigger_conditions': f"txn_type == '{txn_type}'",
                    'expected_debits': ','.join([acc_id for acc_id, _ in top_debits]) if top_debits else '',
                    'expected_credits': ','.join([acc_id for acc_id, _ in top_credits]) if top_credits else '',
                    'account_scope': 'account',
                    'support_count': len(impacts),
                    'consistency_pct': consistency,
                    'confidence_score': confidence,
                    'sample_txn_ids': ','.join(list(sample_txn_ids)[:5]),
                    'exceptions': '',
                    'locked': 'false'
                }
                rules.append(rule)
                rule_count += 1

                if confidence < 0.4:
                    self.rule_warnings.append({
                        'rule_id': rule['rule_id'],
                        'warning_type': 'low_confidence',
                        'detail': f"confidence={confidence:.2f} support={len(impacts)}",
                        'recommendation': 'Needs accountant review before approval'
                    })
                if consistency < 50.0:
                    self.rule_warnings.append({
                        'rule_id': rule['rule_id'],
                        'warning_type': 'low_consistency',
                        'detail': f"consistency={consistency:.1f}%",
                        'recommendation': 'Inconsistent pattern — possible rule conflict'
                    })

        logger.info(f"  ✓ Inferred {rule_count} rules by transaction type")
        return rules

    def infer_rules_by_customer(self) -> List[Dict]:
        """Infer rules based on customer patterns (SalesReceipt walk-in)."""
        logger.info("Inferring rules by customer...")

        # Group SalesReceipt impacts — keyed by locked walkin_customer ID
        walkin_id = self.locked_decisions['walkin_customer']
        by_customer: dict = defaultdict(list)
        for impact in self.impacts:
            if impact['txn_type'] == 'SalesReceipt':
                by_customer[walkin_id].append(impact)

        rules = []
        rule_count = 0

        for customer_id in sorted(by_customer.keys()):
            impacts = by_customer[customer_id]
            if len(impacts) < 5:
                continue

            # Separate debit/credit frequencies properly
            debit_freq: dict = defaultdict(int)
            credit_freq: dict = defaultdict(int)
            for impact in impacts:
                if float(impact['debit_amount']) > 0:
                    debit_freq[impact['account_id']] += 1
                if float(impact['credit_amount']) > 0:
                    credit_freq[impact['account_id']] += 1

            top_debits = sorted(debit_freq.items(), key=lambda x: x[1], reverse=True)[:3]
            top_credits = sorted(credit_freq.items(), key=lambda x: x[1], reverse=True)[:3]

            if top_debits or top_credits:
                confidence = self._calc_confidence(len(impacts), top_debits, top_credits)
                rule = {
                    'rule_id': f"rule_customer_{customer_id}_{len(rules)+1:03d}",
                    # Customer is a condition, NOT an account — keep it in trigger_conditions only
                    'trigger_conditions': (
                        f"txn_type == '{self.locked_decisions['walkin_txn_type']}' "
                        f"AND customer_ref == '{customer_id}'"
                    ),
                    'expected_debits': ','.join([a for a, _ in top_debits]),
                    'expected_credits': ','.join([a for a, _ in top_credits]),
                    'account_scope': 'account',
                    'support_count': len(impacts),
                    'consistency_pct': self._calc_consistency(impacts),
                    'confidence_score': confidence,
                    'sample_txn_ids': ','.join(list({i['txn_id'] for i in impacts})[:5]),
                    'exceptions': '',
                    'locked': 'false'
                }
                rules.append(rule)
                rule_count += 1

                if confidence < 0.4:
                    self.rule_warnings.append({
                        'rule_id': rule['rule_id'],
                        'warning_type': 'low_confidence',
                        'detail': f"confidence={confidence:.2f}",
                        'recommendation': 'Needs accountant review'
                    })

        logger.info(f"  ✓ Inferred {rule_count} rules by customer")
        return rules

    def apply_locked_decisions(self, rules: List[Dict]) -> List[Dict]:
        """
        Apply locked mapping decisions to inferred rules.
        IMPORTANT: walkin_customer ('71') is a QB Customer ID, never an account.
        Walk-in SalesReceipts debit the cash_account ('90') — that is the correct locked account.
        """
        logger.info("Applying locked decisions...")

        cash_account = self.locked_decisions['cash_account']
        walkin_customer = self.locked_decisions['walkin_customer']
        walkin_txn_type = self.locked_decisions['walkin_txn_type']

        for rule in rules:
            cond = rule.get('trigger_conditions', '')

            # Walk-in SalesReceipt: lock debit to cash_account, not to customer ID
            if walkin_customer in cond and walkin_txn_type in cond:
                rule['expected_debits'] = cash_account  # account '90', not customer '71'
                rule['locked'] = 'true'

            # Block parent accounts from appearing as posting targets
            block_parents = set(self.locked_decisions.get('block_parents', []))
            current_debits = set(rule.get('expected_debits', '').split(',')) - {''}
            current_credits = set(rule.get('expected_credits', '').split(',')) - {''}
            if current_debits & block_parents or current_credits & block_parents:
                self.rule_warnings.append({
                    'rule_id': rule['rule_id'],
                    'warning_type': 'blocked_parent_account',
                    'detail': (
                        f"debits={current_debits & block_parents} "
                        f"credits={current_credits & block_parents}"
                    ),
                    'recommendation': 'Remove blocked parent accounts from posting targets'
                })

        return rules

    def write_outputs(self):
        """Write rule outputs."""
        logger.info("Writing rule outputs...")

        # Rules CSV
        rules_file = self.output_dir / "inferred_rules.csv"
        with open(rules_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'rule_id', 'trigger_conditions', 'expected_debits', 'expected_credits',
                'account_scope', 'support_count', 'consistency_pct', 'confidence_score',
                'sample_txn_ids', 'exceptions', 'locked'
            ])
            writer.writeheader()
            writer.writerows(self.rules)
        logger.info(f"  ✓ {rules_file.name}: {len(self.rules)} rules")

        # Rule warnings CSV
        warnings_file = self.output_dir / "rule_warnings.csv"
        with open(warnings_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'rule_id', 'warning_type', 'detail', 'recommendation'
            ])
            writer.writeheader()
            writer.writerows(self.rule_warnings)
        if self.rule_warnings:
            logger.warning(f"  ⚠ {warnings_file.name}: {len(self.rule_warnings)} warnings")
        else:
            logger.info(f"  ✓ {warnings_file.name}: no warnings")

        # Locked decisions JSON
        locked_file = self.output_dir / "locked_decisions.json"
        with open(locked_file, 'w') as f:
            json.dump(self.locked_decisions, f, indent=2)
        logger.info(f"  ✓ {locked_file.name}: locked mapping decisions")

    # ========================================================================
    # Helpers
    # ========================================================================

    @staticmethod
    def _calc_consistency(impacts: List[Dict]) -> float:
        """Calculate consistency % (all transactions match pattern)."""
        if not impacts:
            return 0.0
        # Simplified: % where pattern is consistent
        consistent = len([i for i in impacts if i['net_amount'] != 0])
        return (consistent / len(impacts) * 100) if impacts else 0.0

    @staticmethod
    def _calc_confidence(support: int, debits: List, credits: List) -> float:
        """Calculate confidence score (0-1)."""
        # Simple heuristic: more support + more patterns = higher confidence
        base_confidence = min(support / 100, 1.0)  # Max at 100 txns
        pattern_bonus = min((len(debits) + len(credits)) / 10, 0.5)  # Pattern diversity
        return min(base_confidence + pattern_bonus, 1.0)

def main():
    if len(sys.argv) < 2:
        print("Usage: python infer_posting_rules.py <run_dir>")
        sys.exit(1)

    run_dir = Path(sys.argv[1])
    data_dir = run_dir / "normalized_data"
    output_dir = run_dir / "posting_rules"

    os.makedirs(output_dir, exist_ok=True)

    logger_obj = logging.getLogger(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(output_dir / "rule_inference.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )

    logger_obj.info("=" * 80)
    logger_obj.info("QB POSTING RULE INFERENCE")
    logger_obj.info(f"Input: {data_dir}")
    logger_obj.info(f"Output: {output_dir}")
    logger_obj.info("=" * 80)

    inferencer = PostingRuleInferencer(data_dir, output_dir)

    try:
        inferencer.load_data()

        # Infer rules
        txn_rules = inferencer.infer_rules_by_txn_type()
        cust_rules = inferencer.infer_rules_by_customer()

        # Consolidate
        all_rules = txn_rules + cust_rules

        # Apply locked decisions
        all_rules = inferencer.apply_locked_decisions(all_rules)

        inferencer.rules = all_rules
        inferencer.write_outputs()

        logger_obj.info("\n" + "=" * 80)
        logger_obj.info("RULE INFERENCE COMPLETE")
        logger_obj.info(f"Output: {output_dir}")
        logger_obj.info(f"Total rules: {len(all_rules)}")
        logger_obj.info("=" * 80)

        logger_obj.info(f"\nNext: python render_html_mockups.py {run_dir}")

        return 0

    except Exception as e:
        logger_obj.error(f"Rule inference failed: {str(e)}")
        import traceback
        logger_obj.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    sys.exit(main())
