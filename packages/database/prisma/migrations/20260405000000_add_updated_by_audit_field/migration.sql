-- Add updated_by field to backdated_transactions for audit trail
ALTER TABLE "backdated_transactions" ADD COLUMN "updated_by" UUID;

-- Add foreign key constraint
ALTER TABLE "backdated_transactions"
  ADD CONSTRAINT "backdated_transactions_updated_by_fkey"
  FOREIGN KEY ("updated_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS "idx_backdated_txn_updated_by" ON "backdated_transactions"("updated_by");
