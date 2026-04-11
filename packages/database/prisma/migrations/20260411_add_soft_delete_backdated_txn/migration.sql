-- Add soft delete columns to backdated_transactions
ALTER TABLE "backdated_transactions" ADD COLUMN "deleted_by" UUID,
ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Add index for soft delete queries (WHERE deleted_at IS NULL)
CREATE INDEX "idx_backdated_txn_deleted" ON "backdated_transactions"("deleted_at");

-- Add foreign key for deleted_by
ALTER TABLE "backdated_transactions" ADD CONSTRAINT "backdated_transactions_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
