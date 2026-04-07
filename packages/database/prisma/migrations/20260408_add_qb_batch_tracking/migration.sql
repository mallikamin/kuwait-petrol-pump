-- CreateTable qb_mapping_batches
CREATE TABLE "qb_mapping_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "batch_type" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_reverted" BOOLEAN NOT NULL DEFAULT false,
    "reverted_at" TIMESTAMPTZ,
    "reverted_by" UUID,

    CONSTRAINT "qb_mapping_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on qb_mapping_batches
CREATE INDEX "idx_qb_batch_org_created" ON "qb_mapping_batches"("organization_id", "created_at");
CREATE INDEX "idx_qb_batch_org_reverted" ON "qb_mapping_batches"("organization_id", "is_reverted");

-- CreateTable qb_mapping_history
CREATE TABLE "qb_mapping_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID,
    "mapping_id" UUID,
    "organization_id" UUID NOT NULL,
    "operation" VARCHAR(20) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "local_id" VARCHAR(100) NOT NULL,
    "before_qb_id" VARCHAR(100),
    "before_qb_name" VARCHAR(255),
    "before_is_active" BOOLEAN,
    "after_qb_id" VARCHAR(100),
    "after_qb_name" VARCHAR(255),
    "after_is_active" BOOLEAN,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qb_mapping_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on qb_mapping_history
CREATE INDEX "idx_qb_history_batch" ON "qb_mapping_history"("batch_id");
CREATE INDEX "idx_qb_history_mapping" ON "qb_mapping_history"("mapping_id");
CREATE INDEX "idx_qb_history_entity" ON "qb_mapping_history"("organization_id", "entity_type", "local_id");
CREATE INDEX "idx_qb_history_org_created" ON "qb_mapping_history"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "qb_mapping_batches" ADD CONSTRAINT "qb_mapping_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qb_mapping_history" ADD CONSTRAINT "qb_mapping_history_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "qb_mapping_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
