-- Customer Advance Movements: append-only log of deposits/usages.
-- Running balance is SUM(IN) - SUM(OUT) over non-voided rows.

CREATE TABLE IF NOT EXISTS "customer_advance_movements" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"     UUID        NOT NULL,
    "branch_id"           UUID        NOT NULL,
    "business_date"       DATE        NOT NULL,
    "shift_instance_id"   UUID,
    "customer_id"         UUID        NOT NULL,
    "direction"           VARCHAR(3)  NOT NULL,
    "kind"                VARCHAR(32) NOT NULL,
    "amount"              DECIMAL(12, 2) NOT NULL,
    "bank_id"             UUID,
    "reference_number"    VARCHAR(100),
    "memo"                TEXT,
    "related_sale_id"     UUID,
    "qb_synced"           BOOLEAN     NOT NULL DEFAULT FALSE,
    "qb_journal_entry_id" VARCHAR(100),
    "qb_synced_at"        TIMESTAMPTZ,
    "voided_at"           TIMESTAMPTZ,
    "voided_by"           UUID,
    "void_reason"         TEXT,
    "created_by"          UUID,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_advance_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cust_adv_direction_chk" CHECK ("direction" IN ('IN', 'OUT')),
    CONSTRAINT "cust_adv_amount_pos_chk" CHECK ("amount" > 0)
);

ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_shift_fkey" FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_bank_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_sale_fkey" FOREIGN KEY ("related_sale_id") REFERENCES "sales"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "customer_advance_movements"
    ADD CONSTRAINT "cust_adv_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id");

CREATE INDEX "idx_advance_customer_time"
    ON "customer_advance_movements" ("customer_id", "created_at");
CREATE INDEX "idx_advance_branch_date"
    ON "customer_advance_movements" ("branch_id", "business_date");
CREATE INDEX "idx_advance_org_date"
    ON "customer_advance_movements" ("organization_id", "business_date");
CREATE INDEX "idx_advance_kind"
    ON "customer_advance_movements" ("kind", "direction");
