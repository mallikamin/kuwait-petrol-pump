-- CreateTable
CREATE TABLE "qb_entity_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "local_id" VARCHAR(100) NOT NULL,
    "qb_id" VARCHAR(100) NOT NULL,
    "qb_name" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "qb_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_qb_mapping_org_type" ON "qb_entity_mappings"("organization_id", "entity_type");

-- CreateIndex
CREATE INDEX "idx_qb_mapping_org_active" ON "qb_entity_mappings"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "qb_entity_mappings_organization_id_entity_type_local_id_key" ON "qb_entity_mappings"("organization_id", "entity_type", "local_id");

-- CreateIndex
CREATE UNIQUE INDEX "qb_entity_mappings_organization_id_entity_type_qb_id_key" ON "qb_entity_mappings"("organization_id", "entity_type", "qb_id");

-- AddForeignKey
ALTER TABLE "qb_entity_mappings" ADD CONSTRAINT "qb_entity_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
