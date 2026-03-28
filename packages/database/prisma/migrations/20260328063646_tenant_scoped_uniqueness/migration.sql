-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PKR',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "location" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(10) NOT NULL DEFAULT 'liters',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fuel_type_id" UUID NOT NULL,
    "price_per_liter" DECIMAL(10,2) NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL,
    "effective_to" TIMESTAMPTZ,
    "changed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensing_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "unit_number" INTEGER NOT NULL,
    "name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispensing_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nozzles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispensing_unit_id" UUID NOT NULL,
    "nozzle_number" INTEGER NOT NULL,
    "fuel_type_id" UUID NOT NULL,
    "meter_type" VARCHAR(20) NOT NULL DEFAULT 'digital',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nozzles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255),
    "role" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "shift_number" INTEGER NOT NULL,
    "name" VARCHAR(100),
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shift_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "opened_at" TIMESTAMPTZ,
    "opened_by" UUID,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nozzle_id" UUID NOT NULL,
    "shift_instance_id" UUID NOT NULL,
    "reading_type" VARCHAR(20) NOT NULL,
    "meter_value" DECIMAL(12,2) NOT NULL,
    "image_url" TEXT,
    "ocr_result" DECIMAL(12,2),
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "offline_queue_id" VARCHAR(100),
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_sync_attempt" TIMESTAMPTZ,
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "address" TEXT,
    "vehicle_numbers" TEXT[],
    "credit_limit" DECIMAL(12,2),
    "credit_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "shift_instance_id" UUID,
    "sale_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sale_type" VARCHAR(20) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_method" VARCHAR(50) NOT NULL,
    "customer_id" UUID,
    "vehicle_number" VARCHAR(50),
    "slip_number" VARCHAR(100),
    "cashier_id" UUID,
    "qb_synced" BOOLEAN NOT NULL DEFAULT false,
    "qb_invoice_id" VARCHAR(100),
    "qb_synced_at" TIMESTAMPTZ,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "offline_queue_id" VARCHAR(100),
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_sync_attempt" TIMESTAMPTZ,
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "nozzle_id" UUID NOT NULL,
    "fuel_type_id" UUID NOT NULL,
    "quantity_liters" DECIMAL(10,2) NOT NULL,
    "price_per_liter" DECIMAL(10,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100),
    "barcode" VARCHAR(100),
    "unit_price" DECIMAL(12,2) NOT NULL,
    "cost_price" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "low_stock_threshold" INTEGER,
    "qb_item_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_fuel_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_fuel_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bifurcations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_instance_id" UUID,
    "pmg_total_liters" DECIMAL(10,2),
    "pmg_total_amount" DECIMAL(12,2),
    "hsd_total_liters" DECIMAL(10,2),
    "hsd_total_amount" DECIMAL(12,2),
    "cash_amount" DECIMAL(12,2),
    "credit_amount" DECIMAL(12,2),
    "card_amount" DECIMAL(12,2),
    "pso_card_amount" DECIMAL(12,2),
    "expected_total" DECIMAL(12,2),
    "actual_total" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "variance_notes" TEXT,
    "bifurcated_by" UUID,
    "bifurcated_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bifurcations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qb_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_name" VARCHAR(255) NOT NULL,
    "realm_id" VARCHAR(50) NOT NULL,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "access_token_expires_at" TIMESTAMPTZ,
    "refresh_token_expires_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMPTZ,
    "last_sync_status" VARCHAR(20),
    "sync_mode" VARCHAR(20) NOT NULL DEFAULT 'READ_ONLY',
    "global_kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "approval_required" BOOLEAN NOT NULL DEFAULT true,
    "connected_by" UUID NOT NULL,
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_info" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "qb_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qb_sync_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "result" JSONB,
    "error_message" TEXT,
    "error_code" VARCHAR(50),
    "error_detail" JSONB,
    "http_status_code" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "duration_ms" INTEGER,
    "idempotency_key" VARCHAR(100),
    "batch_id" UUID,
    "checkpoint_id" UUID,
    "approval_status" VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "replayable_from_batch" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "qb_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qb_sync_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" VARCHAR(20) NOT NULL,
    "qb_id" VARCHAR(100),
    "qb_doc_number" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL,
    "http_method" VARCHAR(10),
    "http_url" VARCHAR(500),
    "http_status_code" INTEGER,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "error_message" TEXT,
    "error_code" VARCHAR(50),
    "error_detail" JSONB,
    "duration_ms" INTEGER,
    "amount_cents" INTEGER,
    "batch_id" UUID,
    "synced_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qb_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operation" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(100),
    "direction" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quickbooks_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qb_entity_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "qb_entity_type" VARCHAR(50) NOT NULL,
    "qb_entity_id" VARCHAR(50) NOT NULL,
    "qb_entity_name" VARCHAR(255) NOT NULL,
    "local_entity_type" VARCHAR(50),
    "local_entity_id" UUID,
    "snapshot_data" JSONB NOT NULL,
    "sync_version" INTEGER NOT NULL DEFAULT 1,
    "sync_hash" VARCHAR(64),
    "snapshot_type" VARCHAR(20) NOT NULL,
    "snapshot_by" UUID,
    "notes" TEXT,
    "snapshot_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "qb_entity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "changes" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_fuel_prices_effective" ON "fuel_prices"("fuel_type_id", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "dispensing_units_branch_id_unit_number_key" ON "dispensing_units"("branch_id", "unit_number");

-- CreateIndex
CREATE UNIQUE INDEX "nozzles_dispensing_unit_id_nozzle_number_key" ON "nozzles"("dispensing_unit_id", "nozzle_number");

-- CreateIndex
CREATE INDEX "idx_users_org" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_username_key" ON "users"("organization_id", "username");

-- CreateIndex
CREATE INDEX "idx_shift_instances_date" ON "shift_instances"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "shift_instances_shift_id_date_key" ON "shift_instances"("shift_id", "date");

-- CreateIndex
CREATE INDEX "idx_meter_readings_shift" ON "meter_readings"("shift_instance_id");

-- CreateIndex
CREATE INDEX "idx_meter_readings_nozzle" ON "meter_readings"("nozzle_id", "recorded_at");

-- CreateIndex
CREATE INDEX "idx_meter_readings_sync_status" ON "meter_readings"("sync_status", "last_sync_attempt");

-- CreateIndex
CREATE INDEX "idx_meter_readings_offline_queue" ON "meter_readings"("offline_queue_id");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_nozzle_id_offline_queue_id_key" ON "meter_readings"("nozzle_id", "offline_queue_id");

-- CreateIndex
CREATE INDEX "idx_customers_org" ON "customers"("organization_id");

-- CreateIndex
CREATE INDEX "idx_sales_date" ON "sales"("sale_date");

-- CreateIndex
CREATE INDEX "idx_sales_branch" ON "sales"("branch_id", "sale_date");

-- CreateIndex
CREATE INDEX "idx_sales_branch_sync" ON "sales"("branch_id", "sync_status", "last_sync_attempt");

-- CreateIndex
CREATE INDEX "idx_sales_customer" ON "sales"("customer_id");

-- CreateIndex
CREATE INDEX "idx_sales_qb_sync" ON "sales"("qb_synced", "qb_synced_at");

-- CreateIndex
CREATE INDEX "idx_sales_sync_status" ON "sales"("sync_status", "last_sync_attempt");

-- CreateIndex
CREATE INDEX "idx_sales_offline_queue" ON "sales"("offline_queue_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_branch_id_offline_queue_id_key" ON "sales"("branch_id", "offline_queue_id");

-- CreateIndex
CREATE INDEX "idx_fuel_sales_sale" ON "fuel_sales"("sale_id");

-- CreateIndex
CREATE INDEX "idx_products_org" ON "products"("organization_id");

-- CreateIndex
CREATE INDEX "idx_products_barcode" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "idx_stock_levels_product" ON "stock_levels"("product_id");

-- CreateIndex
CREATE INDEX "idx_stock_levels_branch" ON "stock_levels"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_product_id_branch_id_key" ON "stock_levels"("product_id", "branch_id");

-- CreateIndex
CREATE INDEX "idx_non_fuel_sales_sale" ON "non_fuel_sales"("sale_id");

-- CreateIndex
CREATE INDEX "idx_bifurcations_date" ON "bifurcations"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bifurcations_branch_id_date_shift_instance_id_key" ON "bifurcations"("branch_id", "date", "shift_instance_id");

-- CreateIndex
CREATE INDEX "idx_qb_conn_org_active" ON "qb_connections"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "qb_connections_organization_id_realm_id_key" ON "qb_connections"("organization_id", "realm_id");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_org_status_prio" ON "qb_sync_queue"("organization_id", "status", "priority");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_org_retry" ON "qb_sync_queue"("organization_id", "next_retry_at");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_status_created" ON "qb_sync_queue"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_org_batch" ON "qb_sync_queue"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_org_approval" ON "qb_sync_queue"("organization_id", "approval_status");

-- CreateIndex
CREATE INDEX "idx_qb_sync_queue_checkpoint" ON "qb_sync_queue"("checkpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "qb_sync_queue_organization_id_idempotency_key_key" ON "qb_sync_queue"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_qb_sync_log_org_status" ON "qb_sync_log"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_qb_sync_log_org_entity" ON "qb_sync_log"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_qb_sync_log_org_batch" ON "qb_sync_log"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "idx_qb_sync_status" ON "qb_sync_log"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_qb_sync_entity" ON "qb_sync_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_qb_audit_operation_time" ON "quickbooks_audit_log"("operation", "created_at");

-- CreateIndex
CREATE INDEX "idx_qb_audit_entity" ON "quickbooks_audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_qb_audit_status_time" ON "quickbooks_audit_log"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_qb_audit_created" ON "quickbooks_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_qb_snapshot_org_entity" ON "qb_entity_snapshots"("organization_id", "qb_entity_type", "qb_entity_id");

-- CreateIndex
CREATE INDEX "idx_qb_snapshot_org_type_time" ON "qb_entity_snapshots"("organization_id", "snapshot_type", "snapshot_at");

-- CreateIndex
CREATE INDEX "idx_qb_snapshot_conn_time" ON "qb_entity_snapshots"("connection_id", "snapshot_at");

-- CreateIndex
CREATE INDEX "idx_qb_snapshot_expires" ON "qb_entity_snapshots"("expires_at");

-- CreateIndex
CREATE INDEX "idx_audit_log_user" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_log_entity" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_units" ADD CONSTRAINT "dispensing_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nozzles" ADD CONSTRAINT "nozzles_dispensing_unit_id_fkey" FOREIGN KEY ("dispensing_unit_id") REFERENCES "dispensing_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nozzles" ADD CONSTRAINT "nozzles_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_nozzle_id_fkey" FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_shift_instance_id_fkey" FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_instance_id_fkey" FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_sales" ADD CONSTRAINT "fuel_sales_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_sales" ADD CONSTRAINT "fuel_sales_nozzle_id_fkey" FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_sales" ADD CONSTRAINT "fuel_sales_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_fuel_sales" ADD CONSTRAINT "non_fuel_sales_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_fuel_sales" ADD CONSTRAINT "non_fuel_sales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bifurcations" ADD CONSTRAINT "bifurcations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bifurcations" ADD CONSTRAINT "bifurcations_shift_instance_id_fkey" FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bifurcations" ADD CONSTRAINT "bifurcations_bifurcated_by_fkey" FOREIGN KEY ("bifurcated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_connections" ADD CONSTRAINT "qb_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_queue" ADD CONSTRAINT "qb_sync_queue_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "qb_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_queue" ADD CONSTRAINT "qb_sync_queue_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_log" ADD CONSTRAINT "qb_sync_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "qb_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_log" ADD CONSTRAINT "qb_sync_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_log" ADD CONSTRAINT "qb_sync_log_sale_fkey" FOREIGN KEY ("entity_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_sync_log" ADD CONSTRAINT "qb_sync_log_product_fkey" FOREIGN KEY ("entity_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_entity_snapshots" ADD CONSTRAINT "qb_entity_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "qb_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_entity_snapshots" ADD CONSTRAINT "qb_entity_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
