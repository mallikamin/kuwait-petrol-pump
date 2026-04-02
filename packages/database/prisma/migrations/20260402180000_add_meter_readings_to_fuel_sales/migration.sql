-- Add meter reading fields to fuel_sales table for reconciliation tracking
ALTER TABLE "fuel_sales"
ADD COLUMN "previous_reading" DECIMAL(12,2),
ADD COLUMN "current_reading" DECIMAL(12,2),
ADD COLUMN "calculated_liters" DECIMAL(10,2),
ADD COLUMN "image_url" TEXT,
ADD COLUMN "ocr_confidence" DOUBLE PRECISION,
ADD COLUMN "is_manual_reading" BOOLEAN NOT NULL DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN "fuel_sales"."previous_reading" IS 'Previous meter reading before this sale';
COMMENT ON COLUMN "fuel_sales"."current_reading" IS 'Current meter reading after this sale';
COMMENT ON COLUMN "fuel_sales"."calculated_liters" IS 'Liters calculated from meter difference (current - previous)';
COMMENT ON COLUMN "fuel_sales"."image_url" IS 'URL to meter reading photo (if captured)';
COMMENT ON COLUMN "fuel_sales"."ocr_confidence" IS 'OCR confidence score (0-1) if photo was used';
COMMENT ON COLUMN "fuel_sales"."is_manual_reading" IS 'True if operator manually entered reading, false if OCR extracted';
