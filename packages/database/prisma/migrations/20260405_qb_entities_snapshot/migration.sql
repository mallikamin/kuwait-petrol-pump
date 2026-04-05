-- CreateTable: QB Entities Snapshot Cache
-- Stores snapshots of QuickBooks entities for faster browsing and mapping

CREATE TABLE "qb_entities_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL, -- 'customer', 'item', 'account', 'payment_method'
    "qb_id" VARCHAR(100) NOT NULL,
    "qb_name" VARCHAR(255) NOT NULL,
    "qb_data" JSONB NOT NULL, -- Full QB entity data
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qb_entities_snapshot_pkey" PRIMARY KEY ("id")
);

-- Add foreign key
ALTER TABLE "qb_entities_snapshot" ADD CONSTRAINT "qb_entities_snapshot_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes for fast lookups
CREATE INDEX "idx_qb_entities_snapshot_org_type" ON "qb_entities_snapshot"("organization_id", "entity_type");
CREATE INDEX "idx_qb_entities_snapshot_qb_id" ON "qb_entities_snapshot"("qb_id");
CREATE INDEX "idx_qb_entities_snapshot_name" ON "qb_entities_snapshot"("qb_name");

-- Unique constraint: one QB entity per org
CREATE UNIQUE INDEX "uq_qb_entities_snapshot_org_type_qbid" ON "qb_entities_snapshot"("organization_id", "entity_type", "qb_id");

-- Comment
COMMENT ON TABLE "qb_entities_snapshot" IS 'Cached snapshot of QuickBooks entities for faster browsing and auto-mapping suggestions';
