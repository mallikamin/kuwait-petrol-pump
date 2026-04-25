-- Multi-tenant foundation
-- Date: 2026-04-26
-- Description:
--   Phase 1 of scaling the POS to multi-pump SaaS. STRICTLY ADDITIVE:
--     * Adds tenancy mode + dedicated_db_url to Organization (Pool/Silo path)
--     * Adds per-org branding columns (company_name, company_address,
--       report_footer) to centralize what is currently a hardcoded constant
--       in apps/web/src/utils/reportBranding.ts. Backfill preserves the
--       exact current strings so demo-org reports render identically.
--     * Adds a `code` column to Organization and Branch (login prefix +
--       admin UI identifier). Backfill assigns deterministic codes to
--       existing rows.
--     * Adds a `user_branch_access` join table for future mix-and-match
--       branch assignment (e.g. one accountant covering 5 of 10 pumps).
--       Created here, NOT yet wired into access middleware. Existing
--       middleware behavior is unchanged.
--
--   Zero existing column changes. Zero existing constraint changes.
--   Zero existing query needs to change. Reconciliation, QB sync mapping,
--   backdated finalization logic — all untouched.

-- ============================================================
-- STEP 1: Organization tenancy + branding columns
-- ============================================================

ALTER TABLE "organizations"
  ADD COLUMN "code" VARCHAR(32),
  ADD COLUMN "tenancy_mode" VARCHAR(20) NOT NULL DEFAULT 'pool',
  ADD COLUMN "dedicated_db_url" TEXT,
  ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "company_name" VARCHAR(255),
  ADD COLUMN "company_address" TEXT,
  ADD COLUMN "report_footer" TEXT;

CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

COMMENT ON COLUMN "organizations"."code" IS 'Short tenant code (lowercase). Used as login prefix and in admin UI. Globally unique. Nullable until every existing row has been backfilled.';
COMMENT ON COLUMN "organizations"."tenancy_mode" IS 'pool | silo. Today every org is pool. Future enterprise tenants can be flipped to silo with dedicated_db_url populated; service layer routes to the dedicated DB.';
COMMENT ON COLUMN "organizations"."dedicated_db_url" IS 'Populated only when tenancy_mode = silo. NULL for pool tenants.';
COMMENT ON COLUMN "organizations"."is_demo" IS 'TRUE for the staging/demo org. UI can hide demo orgs from production aggregates.';
COMMENT ON COLUMN "organizations"."features" IS 'Per-org feature flag bag (Json). Default empty.';
COMMENT ON COLUMN "organizations"."company_name" IS 'Display name printed on report headers (CSV + PDF). Backfilled with the current hardcoded constant; new orgs supply their own.';
COMMENT ON COLUMN "organizations"."company_address" IS 'Address line shown beneath the company name on report headers.';
COMMENT ON COLUMN "organizations"."report_footer" IS 'Optional footer line printed at the bottom of report PDFs. NULL hides the footer.';

-- ============================================================
-- STEP 2: Branch code column (per-org unique)
-- ============================================================

ALTER TABLE "branches"
  ADD COLUMN "code" VARCHAR(32);

CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

COMMENT ON COLUMN "branches"."code" IS 'Short branch code (lowercase) within an org. Used as login prefix segment and admin UI. Unique per org.';

-- ============================================================
-- STEP 3: user_branch_access (join table; unused at first)
-- ============================================================

CREATE TABLE "user_branch_access" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "role" VARCHAR(50),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_branch_access_user_branch_unique" UNIQUE ("user_id", "branch_id"),
  CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_user_branch_access_user" ON "user_branch_access"("user_id");
CREATE INDEX "idx_user_branch_access_branch" ON "user_branch_access"("branch_id");

COMMENT ON TABLE "user_branch_access" IS 'Optional many-to-many for users with cherry-picked branch access (mix-and-match). Unused by current middleware; foundation for future per-branch role assignment without breaking existing user.branchId semantics.';
COMMENT ON COLUMN "user_branch_access"."role" IS 'Optional per-branch role override. NULL means inherit users.role.';

-- ============================================================
-- STEP 4: Backfill demo org with current report-branding constants
--
--   The current single production org (Kuwait Petrol Pump / Absormax)
--   gets code='kpc', is_demo=true, and the exact strings that
--   apps/web/src/utils/reportBranding.ts hardcodes today. After this
--   backfill + the per-org branding wiring in this PR, demo-org reports
--   render byte-for-byte identical to pre-migration output.
--
--   If a fresh DB has no orgs (test envs) or somehow more than one
--   un-coded org, the backfill skips — admin sets codes manually via
--   the onboarding scripts.
-- ============================================================

DO $$
DECLARE
  uncoded_count INTEGER;
  target_id UUID;
BEGIN
  SELECT COUNT(*) INTO uncoded_count FROM "organizations" WHERE "code" IS NULL;

  IF uncoded_count = 1 THEN
    SELECT "id" INTO target_id FROM "organizations" WHERE "code" IS NULL;

    UPDATE "organizations"
    SET
      "code" = 'kpc',
      "is_demo" = true,
      "company_name" = COALESCE("company_name", 'Absormax Hygiene Products (Pvt) LTD'),
      "company_address" = COALESCE("company_address", 'Sundar Industrial Estate, Lahore')
    WHERE "id" = target_id;
  END IF;
END $$;

-- Backfill branch codes deterministically as b01, b02, ... within each org
-- (ordered by created_at then id for stability). Idempotent: only touches NULLs.
WITH numbered AS (
  SELECT
    "id",
    'b' || LPAD(
      ROW_NUMBER() OVER (PARTITION BY "organization_id" ORDER BY "created_at", "id")::text,
      2,
      '0'
    ) AS new_code
  FROM "branches"
  WHERE "code" IS NULL
)
UPDATE "branches" b
SET "code" = n.new_code
FROM numbered n
WHERE b."id" = n."id";
