#!/usr/bin/env python3
"""
Reconstruct transaction workflows by linking related documents.
- Invoice -> Payment
- Bill -> BillPayment
- Deposits
- JournalEntry chains
"""

import json
import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Set, Tuple
from collections import defaultdict
import csv

# ============================================================================
# Configuration
# ============================================================================

logger = logging.getLogger(__name__)

class WorkflowReconstructor:
    """Link related transactions into workflows."""

    def __init__(self, data_dir: Path, output_dir: Path):
        self.data_dir = data_dir
        self.output_dir = output_dir

        # In-memory structures
        self.transactions = {}  # txn_id -> txn record
        self.workflows = []  # list of workflow records
        self.workflow_summary = defaultdict(lambda: {
            'count': 0,
            'total_amount': 0.0,
            'frequency': 0
        })

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s | %(levelname)s | %(message)s',
            handlers=[
                logging.FileHandler(output_dir / "workflows.log"),
                logging.StreamHandler(sys.stdout)
            ]
        )
        logger.info(f"WorkflowReconstructor initialized for {data_dir}")

    def load_transactions(self) -> int:
        """Load transactions from CSV."""
        logger.info("Loading transactions...")

        txn_file = self.data_dir / "transactions.csv"
        if not txn_file.exists():
            logger.warning(f"  ⚠ No transactions CSV found")
            return 0

        count = 0
        with open(txn_file) as f:
            reader = csv.DictReader(f)
            for row in reader:
                row['amount_total'] = float(row['amount_total'] or 0)
                self.transactions[row['txn_id']] = row
                count += 1

        logger.info(f"  ✓ Loaded {count} transactions")
        return count

    def link_invoices_to_payments(self) -> List[Dict]:
        """Link Invoice -> Payment workflows."""
        logger.info("Linking invoices to payments...")

        # Group by customer and date range
        invoices_by_customer = defaultdict(list)
        payments_by_customer = defaultdict(list)

        for txn_id, txn in self.transactions.items():
            if txn['txn_type'] == 'Invoice':
                invoices_by_customer[txn['customer_id']].append(txn)
            elif txn['txn_type'] == 'Payment':
                payments_by_customer[txn['customer_id']].append(txn)

        workflows = []
        matched = 0

        for customer_id in invoices_by_customer.keys():
            invoices = sorted(invoices_by_customer[customer_id], key=lambda x: x['txn_date'])
            payments = sorted(payments_by_customer.get(customer_id, []), key=lambda x: x['txn_date'])

            # Simple matching: pair invoices with nearby payments
            for inv in invoices:
                for pay in payments:
                    inv_date = datetime.fromisoformat(inv['txn_date'])
                    pay_date = datetime.fromisoformat(pay['txn_date'])
                    days_diff = abs((pay_date - inv_date).days)

                    # Match if payment within 90 days and amounts close
                    if 0 < days_diff <= 90 and abs(float(inv['amount_total']) - float(pay['amount_total'])) < 0.01:
                        workflow = {
                            'workflow_id': f"inv_pay_{inv['txn_id'][:8]}",
                            'trigger_type': 'Invoice',
                            'doc_sequence': f"Invoice -> Payment",
                            'doc_types': 'Invoice,Payment',
                            'related_txn_ids': f"{inv['txn_id']},{pay['txn_id']}",
                            'customer_id': customer_id,
                            'total_amount': float(inv['amount_total']),
                            'days_to_payment': days_diff,
                            'variance': 0.0
                        }
                        workflows.append(workflow)
                        matched += 1

        logger.info(f"  ✓ Matched {matched} invoice-payment workflows")
        return workflows

    def link_bills_to_payments(self) -> List[Dict]:
        """Link Bill -> BillPayment workflows."""
        logger.info("Linking bills to payments...")

        bills_by_vendor = defaultdict(list)
        payments_by_vendor = defaultdict(list)

        for txn_id, txn in self.transactions.items():
            if txn['txn_type'] == 'Bill':
                bills_by_vendor[txn['vendor_id']].append(txn)
            elif txn['txn_type'] == 'BillPayment':
                payments_by_vendor[txn['vendor_id']].append(txn)

        workflows = []
        matched = 0

        for vendor_id in bills_by_vendor.keys():
            bills = sorted(bills_by_vendor[vendor_id], key=lambda x: x['txn_date'])
            payments = sorted(payments_by_vendor.get(vendor_id, []), key=lambda x: x['txn_date'])

            for bill in bills:
                for pay in payments:
                    bill_date = datetime.fromisoformat(bill['txn_date'])
                    pay_date = datetime.fromisoformat(pay['txn_date'])
                    days_diff = abs((pay_date - bill_date).days)

                    if 0 < days_diff <= 90:
                        workflow = {
                            'workflow_id': f"bill_pay_{bill['txn_id'][:8]}",
                            'trigger_type': 'Bill',
                            'doc_sequence': f"Bill -> BillPayment",
                            'doc_types': 'Bill,BillPayment',
                            'related_txn_ids': f"{bill['txn_id']},{pay['txn_id']}",
                            'vendor_id': vendor_id,
                            'total_amount': float(bill['amount_total']),
                            'days_to_payment': days_diff,
                            'variance': 0.0
                        }
                        workflows.append(workflow)
                        matched += 1

        logger.info(f"  ✓ Matched {matched} bill-payment workflows")
        return workflows

    def group_deposits(self) -> List[Dict]:
        """Group Deposit transactions (cash/check aggregation)."""
        logger.info("Grouping deposits...")

        deposits = [txn for txn in self.transactions.values() if txn['txn_type'] == 'Deposit']
        workflows = []

        # Deposits often group multiple payments
        # For now, treat each deposit as single workflow
        for dep in deposits:
            workflow = {
                'workflow_id': f"dep_{dep['txn_id'][:8]}",
                'trigger_type': 'Deposit',
                'doc_sequence': f"Deposit",
                'doc_types': 'Deposit',
                'related_txn_ids': dep['txn_id'],
                'total_amount': float(dep['amount_total']),
                'days_to_payment': 0,
                'variance': 0.0
            }
            workflows.append(workflow)

        logger.info(f"  ✓ Created {len(workflows)} deposit workflows")
        return workflows

    def detect_sales_receipt_workflows(self) -> List[Dict]:
        """Detect SalesReceipt workflows (walk-in cash sales)."""
        logger.info("Detecting SalesReceipt workflows...")

        sales_receipts = [txn for txn in self.transactions.values() if txn['txn_type'] == 'SalesReceipt']
        workflows = []

        for sr in sales_receipts:
            workflow = {
                'workflow_id': f"sr_{sr['txn_id'][:8]}",
                'trigger_type': 'SalesReceipt',
                'doc_sequence': f"SalesReceipt",
                'doc_types': 'SalesReceipt',
                'related_txn_ids': sr['txn_id'],
                'total_amount': float(sr['amount_total']),
                'days_to_payment': 0,
                'variance': 0.0
            }
            workflows.append(workflow)

        logger.info(f"  ✓ Created {len(workflows)} sales receipt workflows")
        return workflows

    def detect_journal_entry_chains(self) -> List[Dict]:
        """Detect JournalEntry chains (manual postings, transfers)."""
        logger.info("Detecting journal entry chains...")

        journal_entries = sorted(
            [txn for txn in self.transactions.values() if txn['txn_type'] == 'JournalEntry'],
            key=lambda x: x['txn_date']
        )
        workflows = []

        # Look for entries on same date with related doc numbers
        by_date = defaultdict(list)
        for je in journal_entries:
            by_date[je['txn_date']].append(je)

        for date, entries in by_date.items():
            if len(entries) > 1:
                # Potential chain
                workflow = {
                    'workflow_id': f"je_chain_{date[:10]}",
                    'trigger_type': 'JournalEntry',
                    'doc_sequence': f"{len(entries)} JournalEntries on {date}",
                    'doc_types': 'JournalEntry',
                    'related_txn_ids': ','.join([e['txn_id'] for e in entries]),
                    'total_amount': sum(float(e['amount_total']) for e in entries),
                    'days_to_payment': 0,
                    'variance': 0.0
                }
                workflows.append(workflow)

        logger.info(f"  ✓ Detected {len(workflows)} journal entry chains")
        return workflows

    def consolidate_workflows(self, *workflow_lists) -> List[Dict]:
        """Consolidate and deduplicate workflows."""
        logger.info("Consolidating workflows...")

        all_workflows = []
        seen_ids = set()

        for wf_list in workflow_lists:
            for wf in wf_list:
                wf_id = wf['workflow_id']
                if wf_id not in seen_ids:
                    all_workflows.append(wf)
                    seen_ids.add(wf_id)

        logger.info(f"  ✓ Consolidated {len(all_workflows)} unique workflows")
        return all_workflows

    def write_outputs(self):
        """Write workflow outputs."""
        logger.info("Writing workflow outputs...")

        # Workflows JSON
        wf_json = self.output_dir / "workflows.json"
        with open(wf_json, 'w') as f:
            json.dump(self.workflows, f, indent=2)
        logger.info(f"  ✓ {wf_json.name}: {len(self.workflows)} workflows")

        # Workflow summary CSV
        summary_file = self.output_dir / "workflow_summary.csv"
        with open(summary_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'workflow_type', 'count', 'total_amount', 'avg_days_to_close', 'outliers'
            ])
            writer.writeheader()

            by_type = defaultdict(list)
            for wf in self.workflows:
                by_type[wf['trigger_type']].append(wf)

            for wf_type in sorted(by_type.keys()):
                workflows = by_type[wf_type]
                avg_days = sum(float(wf.get('days_to_payment', 0)) for wf in workflows) / len(workflows) if workflows else 0

                writer.writerow({
                    'workflow_type': wf_type,
                    'count': len(workflows),
                    'total_amount': sum(float(wf['total_amount']) for wf in workflows),
                    'avg_days_to_close': f"{avg_days:.1f}",
                    'outliers': len([wf for wf in workflows if float(wf.get('days_to_payment', 0)) > 90])
                })

        logger.info(f"  ✓ {summary_file.name}: workflow summary")

def main():
    if len(sys.argv) < 2:
        print("Usage: python reconstruct_workflows.py <run_dir>")
        sys.exit(1)

    run_dir = Path(sys.argv[1])
    data_dir = run_dir / "normalized_data"
    output_dir = run_dir / "workflows"

    os.makedirs(output_dir, exist_ok=True)

    logger_obj = logging.getLogger(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(output_dir / "workflows.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )

    logger_obj.info("=" * 80)
    logger_obj.info("QB WORKFLOW RECONSTRUCTION")
    logger_obj.info(f"Input: {data_dir}")
    logger_obj.info(f"Output: {output_dir}")
    logger_obj.info("=" * 80)

    reconstructor = WorkflowReconstructor(data_dir, output_dir)

    try:
        reconstructor.load_transactions()

        # Link documents
        inv_pay_wf = reconstructor.link_invoices_to_payments()
        bill_pay_wf = reconstructor.link_bills_to_payments()
        dep_wf = reconstructor.group_deposits()
        sr_wf = reconstructor.detect_sales_receipt_workflows()
        je_wf = reconstructor.detect_journal_entry_chains()

        # Consolidate
        reconstructor.workflows = reconstructor.consolidate_workflows(
            inv_pay_wf, bill_pay_wf, dep_wf, sr_wf, je_wf
        )

        reconstructor.write_outputs()

        logger_obj.info("\n" + "=" * 80)
        logger_obj.info("WORKFLOW RECONSTRUCTION COMPLETE")
        logger_obj.info(f"Output: {output_dir}")
        logger_obj.info("=" * 80)

        logger_obj.info(f"\nNext: python infer_posting_rules.py {run_dir}")

        return 0

    except Exception as e:
        logger_obj.error(f"Workflow reconstruction failed: {str(e)}")
        import traceback
        logger_obj.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    import os
    sys.exit(main())
