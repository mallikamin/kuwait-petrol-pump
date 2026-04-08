-- AddColumn audit metadata fields to meter_readings
ALTER TABLE "meter_readings" ADD COLUMN "submitted_by" UUID NULL;
ALTER TABLE "meter_readings" ADD COLUMN "submitted_at" TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE "meter_readings" ADD COLUMN "attachment_url" TEXT NULL;
ALTER TABLE "meter_readings" ADD COLUMN "ocr_manually_edited" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey to user for submitted_by
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddIndex for audit tracking
CREATE INDEX "idx_meter_readings_submitted_by" ON "meter_readings"("submitted_by");
CREATE INDEX "idx_meter_readings_submitted_at" ON "meter_readings"("submitted_at");
