-- Multi-org access (BPO / cross-tenant admin)
-- Date: 2026-04-26
-- Description:
--   Strictly additive table that grants specific users access to specific
--   organizations beyond their primary org. Mirrors user_branch_access (PR #31)
--   but at the organization level instead of the branch level.
--
--   Single-org users (operator, accountant, cashier) have ZERO rows in this
--   table. The auth middleware ignores X-Active-Org-Id when the user has no
--   rows here, so existing flows remain byte-identical for them.
--
--   Multi-org users (admin, BPOTeam) get one row per accessible org. The
--   frontend sends X-Active-Org-Id on every request; middleware validates
--   the user has a row for that org, then overrides req.user.organizationId
--   for the duration of the request. Service layer queries continue to scope
--   by req.user.organizationId — zero changes required to existing handlers.
--
--   Backfill seeds admin + BPOTeam with access to every existing org so the
--   switcher lights up immediately on deploy. Admin can grant/revoke per
--   user via /admin/clients UI.

-- ============================================================
-- STEP 1: Create user_org_access table
-- ============================================================

CREATE TABLE "user_org_access" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "granted_by" UUID,
  "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_org_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_org_access_user_org_unique" UNIQUE ("user_id", "organization_id"),
  CONSTRAINT "user_org_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_org_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_org_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_user_org_access_user" ON "user_org_access"("user_id");
CREATE INDEX "idx_user_org_access_org" ON "user_org_access"("organization_id");

COMMENT ON TABLE "user_org_access" IS 'Cross-organization access grants for BPO/super-admin users. Empty rows = single-org user (existing behavior). Rows present = user can switch among the listed orgs via X-Active-Org-Id header.';
COMMENT ON COLUMN "user_org_access"."granted_by" IS 'User who granted this access. NULL when seeded by migration or if granter was deleted.';

-- ============================================================
-- STEP 2: Backfill admin + BPOTeam with access to every org
-- ============================================================
-- Idempotent via ON CONFLICT DO NOTHING. Safe to re-run.

INSERT INTO "user_org_access" ("user_id", "organization_id", "granted_at")
SELECT u.id, o.id, CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "organizations" o
WHERE LOWER(u.username) IN ('admin', 'bpoteam')
ON CONFLICT ("user_id", "organization_id") DO NOTHING;
