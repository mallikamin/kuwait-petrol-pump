-- Expense Module: catalog of cash-out account labels + entries.
-- Paired with cash_ledger_entries (source=EXPENSE) on every insert.
-- QB side: each entry enqueues `create_cash_expense` → QB Purchase with
-- AccountBasedExpenseLineDetail paid from the cash account.

CREATE TABLE IF NOT EXISTS "expense_accounts" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"  UUID        NOT NULL,
    "label"            VARCHAR(128) NOT NULL,
    "qb_account_name"  VARCHAR(256),
    "sort_order"       INTEGER     NOT NULL DEFAULT 100,
    "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_org_expense_label"
    ON "expense_accounts" ("organization_id", "label");

CREATE INDEX "idx_expense_accounts_list"
    ON "expense_accounts" ("organization_id", "is_active", "sort_order");

ALTER TABLE "expense_accounts"
    ADD CONSTRAINT "expense_accounts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");

-- Seed the 17 accounts from the client-provided spec, for every existing
-- organization. New organizations will seed at provisioning time via the
-- application layer.
INSERT INTO "expense_accounts" ("organization_id", "label", "qb_account_name", "sort_order")
SELECT o.id, label, qb_name, sort_order FROM "organizations" o, (
    VALUES
        ('Cleaning Expense',              'Admin Expenses:Cleaning Expense',              10),
        ('Electricity Expense',           'Admin Expenses:Electricity expenses',          20),
        ('Entertainment Expense',         'Admin Expenses:Entertainment Expenses',        30),
        ('General Maintenance',           'Admin Expenses:General maintenance',           40),
        ('Generator Expense',             'Admin Expenses:Generator Expense',             50),
        ('Legal Expense',                 'Admin Expenses:Legal expenses',                60),
        ('Motor Bike Petrol',             'Admin Expenses:Motor Bike Petrol',             70),
        ('PTCL Bill',                     'Admin Expenses:PTCL Bill',                     80),
        ('Repair & Maintenance',          'Admin Expenses:Repair & Maintenance expense',  90),
        ('Service Station Operating Exp.','Admin Expenses:Service Station Operating exp', 100),
        ('Staff Accommodation',           'Admin Expenses:Staff Accommodation',           110),
        ('Staff Food',                    'Admin Expenses:Staff Food',                    120),
        ('Stationery',                    'Admin Expenses:Stationery Expenses',           130),
        ('Telephone',                     'Admin Expenses:Telephone Expense',             140),
        ('Advertisement',                 'Admin Expenses:Advertisement expense',         150),
        ('Staff Payroll',                 'Admin Expenses:Staff payroll',                 160),
        ('Miscellaneous',                 'Admin Expenses:Miscellaneous Expenses',        170)
) AS seed(label, qb_name, sort_order)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "expense_entries" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"     UUID        NOT NULL,
    "branch_id"           UUID        NOT NULL,
    "business_date"       DATE        NOT NULL,
    "shift_instance_id"   UUID,
    "expense_account_id"  UUID        NOT NULL,
    "amount"              DECIMAL(12, 2) NOT NULL,
    "memo"                TEXT,
    "attachment_path"     VARCHAR(500),
    "qb_synced"           BOOLEAN     NOT NULL DEFAULT FALSE,
    "qb_purchase_id"      VARCHAR(100),
    "qb_synced_at"        TIMESTAMPTZ,
    "created_by"          UUID,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at"           TIMESTAMPTZ,
    "voided_by"           UUID,
    "void_reason"         TEXT,

    CONSTRAINT "expense_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expense_entries_amount_pos_chk" CHECK ("amount" > 0)
);

ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id");
ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_shift_instance_id_fkey"
    FOREIGN KEY ("shift_instance_id") REFERENCES "shift_instances"("id");
ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_expense_account_id_fkey"
    FOREIGN KEY ("expense_account_id") REFERENCES "expense_accounts"("id");
ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "expense_entries"
    ADD CONSTRAINT "expense_entries_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id");

CREATE INDEX "idx_expense_entries_branch_date"
    ON "expense_entries" ("branch_id", "business_date");
CREATE INDEX "idx_expense_entries_account_date"
    ON "expense_entries" ("expense_account_id", "business_date");
CREATE INDEX "idx_expense_entries_org_date"
    ON "expense_entries" ("organization_id", "business_date");
