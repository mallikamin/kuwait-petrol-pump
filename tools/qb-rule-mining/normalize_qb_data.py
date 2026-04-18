#!/usr/bin/env python3
"""
Normalize raw QB JSONL into canonical tables:
- transactions.csv/parquet
- transaction_lines.csv/parquet
- accounts.csv/parquet
- account_hierarchy.csv/parquet
- account_impacts.csv/parquet
"""

import json
import os
import sys
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import csv

# ============================================================================
# Configuration
# ============================================================================

logger = logging.getLogger(__name__)

class QBNormalizer:
    """Normalize raw QB JSONL to canonical tables."""

    def __init__(self, data_dir: Path, output_dir: Path):
        self.data_dir = data_dir
        self.output_dir = output_dir

        # In-memory structures
        self.accounts = {}  # id -> raw QB Account object (has AccountType)
        self.account_hierarchy = {}  # id -> {parent_id, root_id, fqn, depth}
        self.transactions = []  # list of txn records
        self.transaction_lines = []  # list of line records
        self.account_impacts = []  # list of impact records
        self.unresolved_lines = []  # lines with no AccountRef (captured, not silently dropped)

        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s | %(levelname)s | %(message)s',
            handlers=[
                logging.FileHandler(output_dir / "normalization.log"),
                logging.StreamHandler(sys.stdout)
            ]
        )
        logger.info(f"Normalizer initialized for {data_dir}")

    def load_accounts(self) -> int:
        """Load and index all accounts."""
        logger.info("Loading accounts...")

        accounts_file = self.data_dir / "account.jsonl"
        if not accounts_file.exists():
            logger.warning(f"  ⚠ No accounts file found")
            return 0

        count = 0
        with open(accounts_file) as f:
            for line in f:
                if not line.strip():
                    continue
                account = json.loads(line)
                self.accounts[account['Id']] = account
                count += 1

        logger.info(f"  ✓ Loaded {count} accounts")
        return count

    def build_account_hierarchy(self) -> int:
        """Build parent/root mappings and FQN."""
        logger.info("Building account hierarchy...")

        def get_fqn_and_root(acc_id: str, visited: set = None) -> Tuple[str, str, int]:
            """Get FQN and root_id by walking parent chain."""
            if visited is None:
                visited = set()

            if acc_id in visited:
                return "", "", 0  # Cycle detected

            visited.add(acc_id)

            account = self.accounts.get(acc_id)
            if not account:
                return "", "", 0

            parent_id = account.get('ParentRef', {}).get('value')
            name = account.get('Name', '')

            if not parent_id:
                # Root account
                return name, acc_id, 0

            # Recurse to parent
            parent_fqn, root_id, parent_depth = get_fqn_and_root(parent_id, visited)

            fqn = f"{parent_fqn}/{name}" if parent_fqn else name
            depth = parent_depth + 1

            return fqn, root_id, depth

        for acc_id in self.accounts.keys():
            fqn, root_id, depth = get_fqn_and_root(acc_id)
            parent_id = self.accounts[acc_id].get('ParentRef', {}).get('value')

            self.account_hierarchy[acc_id] = {
                'account_id': acc_id,
                'parent_account_id': parent_id or '',
                'root_account_id': root_id,
                'fully_qualified_name': fqn,
                'depth': depth,
                'account_name': self.accounts[acc_id].get('Name', ''),
                'account_type': self.accounts[acc_id].get('AccountType', ''),
                'account_subtype': self.accounts[acc_id].get('AccountSubType', '')
            }

        logger.info(f"  ✓ Hierarchy built for {len(self.account_hierarchy)} accounts")
        return len(self.account_hierarchy)

    def load_transactions(self) -> int:
        """Load all transactions from transactions.jsonl."""
        logger.info("Loading transactions...")

        txn_file = self.data_dir / "transactions.jsonl"
        if not txn_file.exists():
            logger.warning(f"  ⚠ No transactions file found")
            return 0

        count = 0
        with open(txn_file) as f:
            for line in f:
                if not line.strip():
                    continue
                txn = json.loads(line)
                txn_type = txn.pop('__txn_type', 'Unknown')
                txn['TxnType'] = txn_type

                # Normalize fields
                txn_record = {
                    'txn_id': txn.get('Id', ''),
                    'txn_type': txn_type,
                    'txn_date': txn.get('TxnDate', ''),
                    'doc_number': txn.get('DocNumber', txn.get('RefNumber', '')),
                    'amount_total': self._extract_total(txn),
                    'customer_id': txn.get('CustomerRef', {}).get('value', '') if txn_type == 'Invoice' else '',
                    'vendor_id': txn.get('VendorRef', {}).get('value', '') if txn_type in ['Bill', 'Expense', 'Purchase'] else '',
                    'raw_payload_hash': self._hash_payload(txn)
                }

                self.transactions.append(txn_record)
                count += 1

        logger.info(f"  ✓ Loaded {count} transactions")
        return count

    def extract_transaction_lines(self) -> int:
        """Extract line-item details from transactions."""
        logger.info("Extracting transaction lines...")

        txn_file = self.data_dir / "transactions.jsonl"
        line_count = 0

        # Detail types that carry no direct GL posting (safe to skip without warning)
        NON_POSTING_DETAIL_TYPES = {
            'SubTotalLine', 'DescriptionOnly', 'DiscountLine',
            'TaxLine', 'GroupLine', ''
        }

        with open(txn_file) as f:
            for raw_line in f:
                if not raw_line.strip():
                    continue
                txn = json.loads(raw_line)
                txn_type = txn.pop('__txn_type', 'Unknown')
                txn_id = txn.get('Id', '')
                txn_date = txn.get('TxnDate', '')

                line_items = txn.get('Line', [])
                if not line_items:
                    continue

                for idx, line_item in enumerate(line_items):
                    detail_type = line_item.get('DetailType', '')

                    # Resolve AccountRef from whichever detail block carries it
                    account_id = ''
                    if 'AccountBasedExpenseLineDetail' in line_item:
                        account_id = line_item['AccountBasedExpenseLineDetail'].get(
                            'AccountRef', {}).get('value', '')
                    elif 'JournalEntryLineDetail' in line_item:
                        account_id = line_item['JournalEntryLineDetail'].get(
                            'AccountRef', {}).get('value', '')
                    else:
                        for _key, detail in line_item.items():
                            if isinstance(detail, dict) and 'AccountRef' in detail:
                                account_id = detail['AccountRef'].get('value', '')
                                break

                    amount = float(line_item.get('Amount', 0))

                    # Account-type-aware debit/credit inference
                    debit, credit, inference_method = self._infer_debit_credit_from_line(
                        txn_type, line_item, amount, account_id
                    )

                    if not account_id and detail_type not in NON_POSTING_DETAIL_TYPES:
                        # Capture unresolved — not silently dropped
                        self.unresolved_lines.append({
                            'txn_id': txn_id,
                            'txn_type': txn_type,
                            'txn_date': txn_date,
                            'line_id': f"{txn_id}_{idx}",
                            'detail_type': detail_type,
                            'amount': amount,
                            'reason': 'no_account_ref'
                        })

                    line_record = {
                        'txn_id': txn_id,
                        'txn_type': txn_type,
                        'txn_date': txn_date,
                        'line_id': f"{txn_id}_{idx}",
                        'line_number': idx + 1,
                        'account_id': account_id,
                        'description': line_item.get('Description', ''),
                        'amount': amount,
                        'debit': debit if debit is not None else '',
                        'credit': credit if credit is not None else '',
                        'inference_method': inference_method
                    }

                    self.transaction_lines.append(line_record)
                    line_count += 1

        unresolved_count = len(self.unresolved_lines)
        logger.info(f"  ✓ Extracted {line_count} transaction lines "
                    f"({unresolved_count} unresolved account refs captured)")
        return line_count

    def build_account_impacts(self) -> int:
        """Build account impact records from transaction lines."""
        logger.info("Building account impact records...")

        for line in self.transaction_lines:
            account_id = line['account_id']
            if not account_id:
                continue

            # Lookup hierarchy
            hierarchy = self.account_hierarchy.get(account_id, {})
            if not hierarchy:
                logger.warning(f"  ⚠ Account {account_id} not in hierarchy")
                continue

            impact = {
                'txn_id': line['txn_id'],
                'txn_type': line['txn_type'],
                'txn_date': line['txn_date'],
                'line_id': line['line_id'],
                'account_id': account_id,
                'account_name': hierarchy.get('account_name', ''),
                'parent_account_id': hierarchy.get('parent_account_id', ''),
                'parent_account_name': self.accounts.get(hierarchy.get('parent_account_id', ''), {}).get('Name', ''),
                'root_account_id': hierarchy.get('root_account_id', ''),
                'root_account_name': self.accounts.get(hierarchy.get('root_account_id', ''), {}).get('Name', ''),
                'debit_amount': line['debit'] if line['debit'] else 0,
                'credit_amount': line['credit'] if line['credit'] else 0,
                'net_amount': (line['debit'] if line['debit'] else 0) - (line['credit'] if line['credit'] else 0),
                'source_detail_path': 'Line[{}]'.format(line['line_number'])
            }

            self.account_impacts.append(impact)

        logger.info(f"  ✓ Created {len(self.account_impacts)} impact records")
        return len(self.account_impacts)

    def write_csv_files(self):
        """Write normalized tables to CSV."""
        logger.info("Writing CSV files...")

        # Accounts hierarchy
        accounts_file = self.output_dir / "accounts.csv"
        with open(accounts_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'account_id', 'account_name', 'account_type', 'account_subtype',
                'parent_account_id', 'root_account_id', 'fully_qualified_name', 'depth'
            ])
            writer.writeheader()
            for record in self.account_hierarchy.values():
                writer.writerow(record)
        logger.info(f"  ✓ {accounts_file.name}: {len(self.account_hierarchy)} rows")

        # Transactions
        txn_file = self.output_dir / "transactions.csv"
        with open(txn_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'txn_id', 'txn_type', 'txn_date', 'doc_number', 'amount_total',
                'customer_id', 'vendor_id', 'raw_payload_hash'
            ])
            writer.writeheader()
            writer.writerows(self.transactions)
        logger.info(f"  ✓ {txn_file.name}: {len(self.transactions)} rows")

        # Transaction lines
        lines_file = self.output_dir / "transaction_lines.csv"
        with open(lines_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'txn_id', 'txn_type', 'txn_date', 'line_id', 'line_number', 'account_id',
                'description', 'amount', 'debit', 'credit', 'inference_method'
            ])
            writer.writeheader()
            writer.writerows(self.transaction_lines)
        logger.info(f"  ✓ {lines_file.name}: {len(self.transaction_lines)} rows")

        # Account impacts
        impacts_file = self.output_dir / "account_impacts.csv"
        with open(impacts_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'txn_id', 'txn_type', 'txn_date', 'line_id', 'account_id', 'account_name',
                'parent_account_id', 'parent_account_name', 'root_account_id', 'root_account_name',
                'debit_amount', 'credit_amount', 'net_amount', 'source_detail_path'
            ])
            writer.writeheader()
            writer.writerows(self.account_impacts)
        logger.info(f"  ✓ {impacts_file.name}: {len(self.account_impacts)} rows")

    def write_unresolved_lines(self):
        """Write lines that had no AccountRef to unresolved_account_lines.csv."""
        unresolved_file = self.output_dir / "unresolved_account_lines.csv"
        with open(unresolved_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'txn_id', 'txn_type', 'txn_date', 'line_id', 'detail_type', 'amount', 'reason'
            ])
            writer.writeheader()
            writer.writerows(self.unresolved_lines)
        logger.info(f"  ✓ {unresolved_file.name}: {len(self.unresolved_lines)} unresolved lines")

    # ========================================================================
    # Helpers
    # ========================================================================

    @staticmethod
    def _extract_total(txn: Dict) -> float:
        """Extract total amount from transaction."""
        return float(txn.get('TotalAmt', txn.get('TxnTaxDetail', {}).get('TotalTax', 0)))

    @staticmethod
    def _hash_payload(txn: Dict) -> str:
        """Hash payload for integrity."""
        import hashlib
        return hashlib.sha256(json.dumps(txn, sort_keys=True).encode()).hexdigest()[:16]

    def _infer_debit_credit_from_line(
        self,
        txn_type: str,
        line_item: dict,
        amount: float,
        account_id: str
    ) -> Tuple[Optional[float], Optional[float], str]:
        """
        Infer debit/credit using account-type-aware logic.
        Priority:
          1. JournalEntry explicit PostingType
          2. Account type + transaction direction (from self.accounts lookup)
          3. Transaction-type heuristic fallback
        Returns (debit, credit, inference_method).
        """
        # 1. JournalEntry carries explicit posting direction per line
        if txn_type == 'JournalEntry':
            je_detail = line_item.get('JournalEntryLineDetail', {})
            posting_type = je_detail.get('PostingType', '').lower()
            if posting_type == 'debit':
                return amount, None, 'explicit'
            elif posting_type == 'credit':
                return None, amount, 'explicit'

        # 2. Account-type-aware inference (raw QB AccountType field)
        if account_id and account_id in self.accounts:
            acct_type = self.accounts[account_id].get('AccountType', '').lower()

            if acct_type in ('cost of goods sold', 'expense', 'other expense'):
                if txn_type in ('Bill', 'Expense', 'Purchase', 'JournalEntry'):
                    return amount, None, 'account_type'

            elif acct_type in ('income', 'other income'):
                if txn_type in ('Invoice', 'SalesReceipt'):
                    return None, amount, 'account_type'

            elif acct_type in ('bank', 'other current asset', 'fixed asset', 'other asset'):
                if txn_type in ('Deposit', 'SalesReceipt', 'Payment'):
                    return amount, None, 'account_type'
                elif txn_type in ('BillPayment', 'Purchase', 'Expense'):
                    return None, amount, 'account_type'

            elif 'payable' in acct_type:
                if txn_type == 'Bill':
                    return None, amount, 'account_type'
                elif txn_type == 'BillPayment':
                    return amount, None, 'account_type'

            elif 'receivable' in acct_type:
                if txn_type == 'Invoice':
                    return amount, None, 'account_type'
                elif txn_type == 'Payment':
                    return None, amount, 'account_type'

        # 3. Transaction-type heuristic fallback
        if txn_type in ('Bill', 'Expense', 'Purchase'):
            return amount, None, 'txn_type_heuristic'
        elif txn_type in ('Invoice', 'SalesReceipt', 'Payment', 'BillPayment', 'Deposit'):
            return None, amount, 'txn_type_heuristic'

        return None, None, 'unresolved'

def main():
    if len(sys.argv) < 2:
        print("Usage: python normalize_qb_data.py <run_dir>")
        sys.exit(1)

    run_dir = Path(sys.argv[1])
    data_dir = run_dir / "raw_data"
    output_dir = run_dir / "normalized_data"

    os.makedirs(output_dir, exist_ok=True)

    logger = logging.getLogger(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(output_dir / "normalization.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )

    logger.info("=" * 80)
    logger.info("QB DATA NORMALIZATION")
    logger.info(f"Input: {data_dir}")
    logger.info(f"Output: {output_dir}")
    logger.info("=" * 80)

    normalizer = QBNormalizer(data_dir, output_dir)

    try:
        normalizer.load_accounts()
        normalizer.build_account_hierarchy()
        normalizer.load_transactions()
        normalizer.extract_transaction_lines()
        normalizer.build_account_impacts()
        normalizer.write_csv_files()
        normalizer.write_unresolved_lines()

        logger.info("\n" + "=" * 80)
        logger.info("NORMALIZATION COMPLETE")
        logger.info(f"Output: {output_dir}")
        logger.info("=" * 80)

        logger.info(f"\nNext: python reconstruct_workflows.py {run_dir}")

        return 0

    except Exception as e:
        logger.error(f"Normalization failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    sys.exit(main())
