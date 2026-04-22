-- EOD Cash Reconciliation: supervisor submits physical cash count and
-- the system records variance (physical - expected) against the
-- ledger-computed expected total.

CREATE TABLE IF NOT EXISTS "cash_reconciliations" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"      UUID        NOT NULL,
    "branch_id"            UUID        NOT NULL,
    "business_date"        DATE        NOT NULL,
    "expected_cash"        DECIMAL(12, 2) NOT NULL,
    "physical_cash"        DECIMAL(12, 2) NOT NULL,
    "variance"             DECIMAL(12, 2) NOT NULL,
    "status"               VARCHAR(20) NOT NULL DEFAULT 'open',
    "notes"                TEXT,
    "submitted_by"         UUID,
    "submitted_at"         TIMESTAMPTZ,
    "closed_by"            UUID,
    "closed_at"            TIMESTAMPTZ,
    "variance_ledger_id"   UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_reconciliations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_reconciliations_status_chk" CHECK ("status" IN ('open', 'closed'))
);

CREATE UNIQUE INDEX "unique_recon_branch_date"
    ON "cash_reconciliations" ("branch_id", "business_date");
CREATE INDEX "idx_recon_org_date"
    ON "cash_reconciliations" ("organization_id", "business_date");
CREATE INDEX "idx_recon_status_date"
    ON "cash_reconciliations" ("status", "business_date");

ALTER TABLE "cash_reconciliations"
    ADD CONSTRAINT "cash_reconciliations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "cash_reconciliations"
    ADD CONSTRAINT "cash_reconciliations_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id");
ALTER TABLE "cash_reconciliations"
    ADD CONSTRAINT "cash_reconciliations_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id");
ALTER TABLE "cash_reconciliations"
    ADD CONSTRAINT "cash_reconciliations_closed_by_fkey"
    FOREIGN KEY ("closed_by") REFERENCES "users"("id");
