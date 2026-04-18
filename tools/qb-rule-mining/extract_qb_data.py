#!/usr/bin/env python3
"""
Extract QB data for 1-year window (2025-04-18 to 2026-04-18).
Immutable JSONL storage with extraction manifest.

SAFETY: GET-only, no write methods allowed. Fails fast on violations.
"""

import json
import os
import sys
import logging
from datetime import datetime
from pathlib import Path
import hashlib
from typing import Dict, List, Any, Optional
import requests

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent.parent
OUTPUTS_ROOT = PROJECT_ROOT / "outputs" / "qb-rule-mining"

# Accept RUN_DIR from shell (run_pipeline.sh passes it) to keep all phases in sync
if len(sys.argv) > 1 and sys.argv[1]:
    RUN_DIR = Path(sys.argv[1])
    RUN_TS = RUN_DIR.name
else:
    RUN_TS = datetime.now().isoformat(timespec='seconds').replace(':', '-')
    RUN_DIR = OUTPUTS_ROOT / RUN_TS

DATA_DIR = RUN_DIR / "raw_data"

START_DATE = "2025-04-18"
END_DATE = "2026-04-18"

# QB entities and transaction types to extract
MASTER_ENTITIES = ["Account", "Customer", "Item", "PaymentMethod", "Term"]
TXN_ENTITIES = [
    "SalesReceipt",
    "Invoice",
    "Payment",
    "Bill",
    "BillPayment",
    "JournalEntry",
    "Deposit",
    "Purchase",
    # "Expense" is NOT a valid QBO query entity — Purchase covers all expense types
]

# HTTP verb enforcement
ALLOWED_VERBS = {"GET"}

# Setup logging
os.makedirs(RUN_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(RUN_DIR / "extraction.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# API audit log — every request logged to prove read-only behavior
_audit_handler = logging.FileHandler(RUN_DIR / "api_audit.log")
_audit_handler.setFormatter(logging.Formatter('%(asctime)s | %(message)s'))
audit_logger = logging.getLogger('qb_api_audit')
audit_logger.setLevel(logging.INFO)
audit_logger.addHandler(_audit_handler)
audit_logger.propagate = False

# ============================================================================
# Safety Enforcement
# ============================================================================

class HTTPVerbViolation(Exception):
    """Raised if non-GET HTTP method is attempted."""
    pass

def enforce_get_only(method: str):
    """Fail fast if non-GET HTTP method attempted."""
    if method.upper() not in ALLOWED_VERBS:
        raise HTTPVerbViolation(
            f"❌ HTTP method violation: {method.upper()} not allowed. "
            f"Only GET permitted for read-only analysis."
        )

# ============================================================================
# QB API Access (Read-Only)
# ============================================================================

class QBDataExtractor:
    """Extract QB data safely (GET-only)."""

    def __init__(self, api_base_url: str, access_token: str, realm_id: str):
        self.api_base_url = api_base_url.rstrip('/')
        self.access_token = access_token
        self.realm_id = realm_id
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {access_token}',
            'Accept': 'application/json'
        })
        self.extraction_stats = {
            'entities_pulled': {},
            'api_pages': {},
            'errors': [],
            'warnings': []
        }

    def get(self, endpoint: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """GET request wrapper with safety enforcement and audit logging."""
        enforce_get_only('GET')

        # QBO production URL: /v3/company/{realmId}/...
        url = f"{self.api_base_url}/v3/company/{self.realm_id}{endpoint}"
        _params = dict(params or {})
        _params.setdefault('minorversion', '65')
        try:
            response = self.session.get(url, params=_params, timeout=30)
            audit_logger.info(
                f"GET | {endpoint} | params={list((params or {}).keys())} "
                f"| status={response.status_code}"
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            audit_logger.info(f"GET | {endpoint} | status=ERROR | error={type(e).__name__}")
            msg = f"API error on {endpoint}: {str(e)}"
            logger.error(msg)
            self.extraction_stats['errors'].append(msg)
            return {}

    def extract_entity(self, entity_type: str) -> int:
        """Extract all records of entity type with pagination.

        QBO requires STARTPOSITION and MAXRESULTS embedded in the SQL query string.
        They are NOT accepted as separate URL parameters.
        """
        logger.info(f"Extracting {entity_type}...")

        output_file = DATA_DIR / f"{entity_type.lower()}.jsonl"
        record_count = 0
        page = 1
        PAGE_SIZE = 100

        while True:
            start = (page - 1) * PAGE_SIZE + 1
            params = {
                'query': f"select * from {entity_type} STARTPOSITION {start} MAXRESULTS {PAGE_SIZE}"
            }

            data = self.get('/query', params=params)

            if not data or 'QueryResponse' not in data:
                break

            response = data['QueryResponse']
            entities = response.get(entity_type, [])

            if not entities:
                break

            with open(output_file, 'a') as f:
                for entity in entities:
                    f.write(json.dumps(entity) + '\n')
                    record_count += 1

            if len(entities) < PAGE_SIZE:
                break

            page += 1

        self.extraction_stats['entities_pulled'][entity_type] = record_count
        self.extraction_stats['api_pages'][entity_type] = page
        logger.info(f"  {record_count} {entity_type} records ({page} pages)")

        return record_count

    def extract_transactions(self, start_date: str, end_date: str) -> int:
        """Extract transactions within date range."""
        logger.info(f"Extracting transactions ({start_date} to {end_date})...")

        total = 0
        output_file = DATA_DIR / "transactions.jsonl"

        PAGE_SIZE = 100

        for txn_type in TXN_ENTITIES:
            base_query = (
                f"select * from {txn_type} "
                f"where TxnDate >= '{start_date}' and TxnDate <= '{end_date}'"
            )

            page = 1
            type_count = 0

            while True:
                start = (page - 1) * PAGE_SIZE + 1
                # STARTPOSITION/MAXRESULTS must be in the SQL string (QBO requirement)
                params = {
                    'query': f"{base_query} STARTPOSITION {start} MAXRESULTS {PAGE_SIZE}"
                }

                data = self.get('/query', params=params)

                if not data or 'QueryResponse' not in data:
                    break

                response = data['QueryResponse']
                entities = response.get(txn_type, [])

                if not entities:
                    break

                with open(output_file, 'a') as f:
                    for entity in entities:
                        entity['__txn_type'] = txn_type
                        f.write(json.dumps(entity) + '\n')
                        type_count += 1
                        total += 1

                if len(entities) < PAGE_SIZE:
                    break

                page += 1

            if type_count > 0:
                self.extraction_stats['entities_pulled'][txn_type] = type_count
                self.extraction_stats['api_pages'][txn_type] = page
                logger.info(f"  {type_count} {txn_type} records")

        return total

    def get_company_info(self) -> Dict[str, Any]:
        """Fetch company metadata."""
        data = self.get('/companyinfo/' + self.realm_id)
        return data.get('CompanyInfo', {})

# ============================================================================
# Main Extraction Flow
# ============================================================================

def _load_dotenv(env_file: Path):
    """Simple .env parser — sets QB-related env vars from KEY=VALUE lines without overwriting existing."""
    QB_KEYS = {
        'QB_ACCESS_TOKEN', 'QB_REALM_ID', 'QB_API_BASE_URL',
        'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'
    }
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # Only set QB keys; don't overwrite already-exported vars
            if key in QB_KEYS and not os.environ.get(key):
                os.environ[key] = value


def load_credentials() -> tuple:
    """
    Load QB credentials in priority order:
    1. project-root .env  (QB_ACCESS_TOKEN / QB_REALM_ID)
    2. project-root qb_tokens.json  (written by OAuth export helper)
    3. Already-exported environment variables
    Aborts with clear instructions if credentials still missing.
    """
    # 1. Project-root .env
    env_file = PROJECT_ROOT / '.env'
    if env_file.exists():
        _load_dotenv(env_file)
        logger.info(f"  ✓ Loaded env vars from {env_file.name}")

    # 2. qb_tokens.json (optional token file from OAuth export helper)
    tokens_file = PROJECT_ROOT / 'qb_tokens.json'
    if tokens_file.exists():
        with open(tokens_file) as f:
            tokens = json.load(f)
        if tokens.get('access_token') and not os.environ.get('QB_ACCESS_TOKEN'):
            os.environ['QB_ACCESS_TOKEN'] = tokens['access_token']
        if tokens.get('realm_id') and not os.environ.get('QB_REALM_ID'):
            os.environ['QB_REALM_ID'] = tokens['realm_id']
        logger.info(f"  ✓ Loaded tokens from {tokens_file.name}")

    api_base_url = os.getenv('QB_API_BASE_URL', 'https://quickbooks.api.intuit.com')
    access_token = os.getenv('QB_ACCESS_TOKEN')
    realm_id = os.getenv('QB_REALM_ID')

    if not access_token or not realm_id:
        logger.error("❌ QB credentials not found. Tried:")
        logger.error(f"   1. {env_file}  (set QB_ACCESS_TOKEN and QB_REALM_ID)")
        logger.error(f"   2. {tokens_file}  ({{ \"access_token\": \"...\", \"realm_id\": \"...\" }})")
        logger.error(f"   3. Environment: export QB_ACCESS_TOKEN=... QB_REALM_ID=...")
        raise ValueError("QB credentials not found")

    masked_realm = realm_id[:4] + '****' if len(realm_id) >= 4 else '****'
    logger.info(f"  ✓ Realm ID: {masked_realm} (masked)")
    return api_base_url, access_token, realm_id

def create_manifest(extractor: QBDataExtractor, company_info: Dict) -> Dict:
    """Create extraction manifest."""
    manifest = {
        'run_ts': RUN_TS,
        'start_date': START_DATE,
        'end_date': END_DATE,
        'company_id': company_info.get('Id'),
        'company_name': company_info.get('CompanyName'),
        'extraction_stats': extractor.extraction_stats,
        'files_created': [
            f.name for f in sorted(DATA_DIR.glob('*.jsonl'))
        ],
        'pipeline_version': '1.0'
    }

    # Add hashes for integrity
    manifest['file_hashes'] = {}
    for jsonl_file in DATA_DIR.glob('*.jsonl'):
        with open(jsonl_file, 'rb') as f:
            manifest['file_hashes'][jsonl_file.name] = hashlib.sha256(f.read()).hexdigest()

    return manifest

def main():
    try:
        logger.info("=" * 80)
        logger.info("QB DATA EXTRACTION PIPELINE (READ-ONLY)")
        logger.info(f"Run timestamp: {RUN_TS}")
        logger.info(f"Output directory: {RUN_DIR}")
        logger.info("=" * 80)

        # Load credentials
        logger.info("\n[1/4] Loading QB credentials...")
        api_base_url, access_token, realm_id = load_credentials()
        logger.info(f"  ✓ Using realm: {realm_id}")

        # Create extractor
        logger.info("\n[2/4] Initializing QB API client (GET-only mode)...")
        extractor = QBDataExtractor(api_base_url, access_token, realm_id)

        # Verify company access
        company_info = extractor.get_company_info()
        if not company_info:
            raise RuntimeError("Failed to fetch company info")
        logger.info(f"  ✓ Company: {company_info.get('CompanyName')}")

        # Extract master entities
        logger.info("\n[3/4] Extracting master entities...")
        for entity in MASTER_ENTITIES:
            extractor.extract_entity(entity)

        # Extract transactions
        logger.info("\n[4/4] Extracting transactions...")
        txn_count = extractor.extract_transactions(START_DATE, END_DATE)
        logger.info(f"  ✓ Total transactions: {txn_count}")

        # Create manifest
        logger.info("\nCreating extraction manifest...")
        manifest = create_manifest(extractor, company_info)

        manifest_file = RUN_DIR / "manifest.json"
        with open(manifest_file, 'w') as f:
            json.dump(manifest, f, indent=2)
        logger.info(f"  ✓ Manifest: {manifest_file}")

        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("EXTRACTION COMPLETE")
        logger.info(f"Output directory: {RUN_DIR}")
        logger.info(f"Total records: {sum(manifest['extraction_stats']['entities_pulled'].values())}")
        logger.info(f"Errors: {len(manifest['extraction_stats']['errors'])}")
        logger.info("=" * 80)

        # Next step
        logger.info(f"\nNext: python normalize_qb_data.py {RUN_DIR}")

        return 0

    except HTTPVerbViolation as e:
        logger.critical(str(e))
        return 1
    except Exception as e:
        logger.error(f"Extraction failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    sys.exit(main())
