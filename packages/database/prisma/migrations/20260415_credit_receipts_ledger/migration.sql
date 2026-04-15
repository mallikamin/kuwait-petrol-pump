-- Credit Customer Receipts + Ledger Migration
-- Version: 2.1
-- Date: 2026-04-15
-- Status: Ready for production deployment

-- ============================================================
-- STEP 1: Add current_balance to customers table
-- ============================================================

ALTER TABLE "customers" ADD COLUMN "current_balance" DECIMAL(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN "customers"."current_balance" IS 'Cached balance. Positive = customer owes us. Updated via full recalculation on balance-modifying operations.';

-- ============================================================
-- STEP 2: Create customer_branch_limits table
-- ============================================================

CREATE TABLE "customer_branch_limits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "credit_limit" DECIMAL(12, 2) NOT NULL,
  "credit_days" INT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "customer_branch_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_branch_limits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_branch_limits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_branch_limits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "unique_customer_branch_limit" ON "customer_branch_limits"("organization_id", "customer_id", "branch_id");
CREATE INDEX "idx_customer_branch_limits_org" ON "customer_branch_limits"("organization_id");
CREATE INDEX "idx_customer_branch_limits_customer" ON "customer_branch_limits"("customer_id");

COMMENT ON TABLE "customer_branch_limits" IS 'Branch-scoped credit limits. Overrides Customer.creditLimit when present.';

-- ============================================================
-- STEP 3: Create customer_receipts table
-- ============================================================

CREATE TABLE "customer_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "receipt_number" VARCHAR(50) NOT NULL,
  "receipt_datetime" TIMESTAMPTZ NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "payment_method" VARCHAR(50) NOT NULL,
  "bank_id" UUID,
  "reference_number" VARCHAR(100),
  "notes" TEXT,
  "attachment_path" VARCHAR(500),
  "allocation_mode" VARCHAR(10) NOT NULL DEFAULT 'FIFO',
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_receipts_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "customer_receipts_allocation_mode_check" CHECK ("allocation_mode" IN ('FIFO', 'MANUAL'))
);

CREATE UNIQUE INDEX "unique_receipt_number" ON "customer_receipts"("organization_id", "receipt_number");
CREATE INDEX "idx_receipts_customer" ON "customer_receipts"("customer_id");
CREATE INDEX "idx_receipts_datetime" ON "customer_receipts"("receipt_datetime");
CREATE INDEX "idx_receipts_org" ON "customer_receipts"("organization_id");
CREATE INDEX "idx_receipts_deleted" ON "customer_receipts"("deleted_at");

COMMENT ON TABLE "customer_receipts" IS 'Payments received from credit customers. Supports backdating.';
COMMENT ON COLUMN "customer_receipts"."receipt_datetime" IS 'Business datetime (supports backdating for historical entries)';
COMMENT ON COLUMN "customer_receipts"."allocation_mode" IS 'FIFO (auto, oldest first) or MANUAL (user-selected invoices)';

-- ============================================================
-- STEP 4: Create customer_receipt_allocations table
-- ============================================================

CREATE TABLE "customer_receipt_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receipt_id" UUID NOT NULL,
  "source_type" VARCHAR(30) NOT NULL,
  "source_id" UUID NOT NULL,
  "allocated_amount" DECIMAL(12, 2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "customer_receipt_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_receipt_allocations_amount_positive" CHECK ("allocated_amount" > 0),
  CONSTRAINT "customer_receipt_allocations_source_type_check" CHECK ("source_type" IN ('BACKDATED_TRANSACTION', 'SALE'))
);

CREATE INDEX "idx_allocations_receipt" ON "customer_receipt_allocations"("receipt_id");
CREATE INDEX "idx_allocations_source" ON "customer_receipt_allocations"("source_type", "source_id");

COMMENT ON TABLE "customer_receipt_allocations" IS 'Maps receipt payments to specific credit invoices. Replace-on-edit: old allocations deleted, new created within transaction. Audit via audit_log.';
COMMENT ON COLUMN "customer_receipt_allocations"."source_type" IS 'BACKDATED_TRANSACTION or SALE';
