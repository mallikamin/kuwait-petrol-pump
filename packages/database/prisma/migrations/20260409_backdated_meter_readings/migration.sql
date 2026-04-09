-- CreateTable: backdated_meter_readings
-- Purpose: Shift-independent meter readings for backdated entry workflow
-- Author: System (P0 Structural Fix)
-- Date: 2026-04-09

CREATE TABLE IF NOT EXISTS "backdated_meter_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "nozzle_id" UUID NOT NULL,
    "reading_type" VARCHAR(20) NOT NULL,
    "meter_value" DECIMAL(12,3) NOT NULL,

    -- Audit fields
    "source" VARCHAR(20),
    "image_url" TEXT,
    "attachment_url" TEXT,
    "ocr_confidence" DOUBLE PRECISION,
    "ocr_manually_edited" BOOLEAN NOT NULL DEFAULT false,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backdated_meter_readings_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraints
ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_nozzle_id_fkey"
    FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "backdated_meter_readings_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add unique constraint
CREATE UNIQUE INDEX "unique_branch_date_nozzle_type"
    ON "backdated_meter_readings"("branch_id", "business_date", "nozzle_id", "reading_type");

-- Add indexes
CREATE INDEX "idx_backdated_meter_org_branch_date"
    ON "backdated_meter_readings"("organization_id", "branch_id", "business_date");

CREATE INDEX "idx_backdated_meter_nozzle_date"
    ON "backdated_meter_readings"("nozzle_id", "business_date");

CREATE INDEX "idx_backdated_meter_date"
    ON "backdated_meter_readings"("business_date");

-- Add constraint check for reading_type
ALTER TABLE "backdated_meter_readings" ADD CONSTRAINT "check_reading_type"
    CHECK ("reading_type" IN ('opening', 'closing'));
