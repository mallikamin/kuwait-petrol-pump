-- Add is_finalized column to backdated_entries
ALTER TABLE "backdated_entries" ADD COLUMN "is_finalized" BOOLEAN NOT NULL DEFAULT false;

-- Add QB sync fields to backdated_transactions
ALTER TABLE "backdated_transactions" ADD COLUMN "qb_sync_status" VARCHAR(20) DEFAULT 'pending';
ALTER TABLE "backdated_transactions" ADD COLUMN "qb_sync_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "backdated_transactions" ADD COLUMN "qb_last_error" TEXT;
ALTER TABLE "backdated_transactions" ADD COLUMN "qb_id" VARCHAR(100);
ALTER TABLE "backdated_transactions" ADD COLUMN "qb_synced_at" TIMESTAMPTZ;

-- Add indexes for new fields
CREATE INDEX "idx_backdated_entries_finalized" ON "backdated_entries"("is_finalized");
CREATE INDEX "idx_backdated_txn_qb_sync_status" ON "backdated_transactions"("qb_sync_status");
