-- Cash Ledger: every physical-cash inflow/outflow through the drawer.
-- Append-only. Source enum strings kept flexible so new modules (expenses,
-- PSO top-ups, driver handouts, advance deposits) can post without schema
-- churn. Unique constraint on (source, source_id, direction) makes posts
-- idempotent — retries and late sync will not double-count.

CREATE TABLE IF NOT EXISTS "cash_ledger_entries" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"   UUID        NOT NULL,
    "branch_id"         UUID        NOT NULL,
    "business_date"     DATE        NOT NULL,
    "shift_instance_id" UUID,
    "direction"         VARCHAR(3)  NOT NULL,
    "source"            VARCHAR(32) NOT NULL,
    "source_id"         UUID,
    "amount"            DECIMAL(12, 2) NOT NULL,
    "memo"              TEXT,
    "created_by"        UUID,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at"       TIMESTAMPTZ,
    "reversed_by"       UUID,
    "reversal_reason"   TEXT,

    CONSTRAINT "cash_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_ledger_entries_direction_chk" CHECK ("direction" IN ('IN', 'OUT')),
    CONSTRAINT "cash_ledger_entries_amount_pos_chk" CHECK ("amount" > 0)
);

-- Foreign keys
ALTER TABLE "cash_ledger_entries"
    ADD CONSTRAINT "cash_ledger_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");

ALTER TABLE "cash_ledger_entries"
    ADD CONSTRAINT "cash_ledger_entries_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id");

ALTER TABLE "cash_ledger_entries"
    ADD CONSTRAINT "cash_ledger_entries_shift_instance_id_fkey"
    FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id");

ALTER TABLE "cash_ledger_entries"
    ADD CONSTRAINT "cash_ledger_entries_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "cash_ledger_entries"
    ADD CONSTRAINT "cash_ledger_entries_reversed_by_fkey"
    FOREIGN KEY ("reversed_by") REFERENCES "users"("id");

-- Indexes
CREATE UNIQUE INDEX "unique_cash_ledger_source_direction"
    ON "cash_ledger_entries" ("source", "source_id", "direction");

CREATE INDEX "idx_cash_ledger_branch_date"
    ON "cash_ledger_entries" ("branch_id", "business_date");

CREATE INDEX "idx_cash_ledger_branch_dir_time"
    ON "cash_ledger_entries" ("branch_id", "direction", "created_at");

CREATE INDEX "idx_cash_ledger_source"
    ON "cash_ledger_entries" ("source", "source_id");

CREATE INDEX "idx_cash_ledger_org_date"
    ON "cash_ledger_entries" ("organization_id", "business_date");
