-- Add QuickBooks sync status fields to backdated_transactions
ALTER TABLE backdated_transactions
ADD COLUMN qb_sync_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN qb_sync_attempts INTEGER DEFAULT 0,
ADD COLUMN qb_last_error TEXT,
ADD COLUMN qb_id VARCHAR(100),
ADD COLUMN qb_doc_number VARCHAR(100),
ADD COLUMN qb_synced_at TIMESTAMPTZ;

-- Add is_finalized to backdated_entries (prevent editing after QB sync)
ALTER TABLE backdated_entries
ADD COLUMN is_finalized BOOLEAN DEFAULT false;

-- Add index for QB sync status queries
CREATE INDEX idx_backdated_txn_qb_sync ON backdated_transactions(qb_sync_status) WHERE qb_sync_status != 'synced';

-- Add index for finalized entries
CREATE INDEX idx_backdated_entries_finalized ON backdated_entries(is_finalized, business_date DESC);

COMMENT ON COLUMN backdated_transactions.qb_sync_status IS 'pending | synced | failed | cancelled';
COMMENT ON COLUMN backdated_entries.is_finalized IS 'Lock entries after QB sync enqueue';
