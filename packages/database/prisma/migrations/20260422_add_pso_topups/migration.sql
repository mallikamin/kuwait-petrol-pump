-- Cash-to-PSO-Card Top-Up: customer hands cash, pump loads PSO Card.
-- Cash IN (ledger source=PSO_TOPUP) + QB JournalEntry DR Cash / CR PSO
-- Payable (A/P with EntityRef=PSO vendor).

CREATE TABLE IF NOT EXISTS "pso_topups" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"      UUID        NOT NULL,
    "branch_id"            UUID        NOT NULL,
    "business_date"        DATE        NOT NULL,
    "shift_instance_id"    UUID,
    "customer_id"          UUID,
    "pso_card_last4"       VARCHAR(10),
    "amount"               DECIMAL(12, 2) NOT NULL,
    "memo"                 TEXT,
    "qb_synced"            BOOLEAN     NOT NULL DEFAULT FALSE,
    "qb_journal_entry_id"  VARCHAR(100),
    "qb_synced_at"         TIMESTAMPTZ,
    "voided_at"            TIMESTAMPTZ,
    "voided_by"            UUID,
    "void_reason"          TEXT,
    "created_by"           UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pso_topups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pso_topups_amount_pos_chk" CHECK ("amount" > 0)
);

ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id");
ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_shift_instance_id_fkey"
    FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id");
ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id");
ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "pso_topups"
    ADD CONSTRAINT "pso_topups_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id");

CREATE INDEX "idx_pso_topup_branch_date"
    ON "pso_topups" ("branch_id", "business_date");
CREATE INDEX "idx_pso_topup_org_date"
    ON "pso_topups" ("organization_id", "business_date");
