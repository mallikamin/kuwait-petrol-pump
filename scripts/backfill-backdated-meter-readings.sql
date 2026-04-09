-- Backfill Script: Migrate Meter Readings to backdated_meter_readings Table
-- Purpose: Copy meter readings from shift-based table to shift-independent backdated table
-- Author: System (P0 Structural Fix)
-- Date: 2026-04-09
-- Usage:
--   DRY RUN:  psql ... < backfill-backdated-meter-readings.sql
--   APPLY:    Set DRY_RUN=false and re-run

-- Configuration (change to 'false' to apply)
\set DRY_RUN true

BEGIN;

-- Create temp table to track what will be migrated
CREATE TEMP TABLE backfill_preview AS
SELECT
    mr.id AS meter_reading_id,
    si.branch_id,
    si.date AS business_date,
    mr.nozzle_id,
    mr.reading_type,
    mr.meter_value,
    mr.image_url,
    mr.ocr_confidence,
    mr.is_manual_reading,
    mr.recorded_by AS created_by,
    mr.submitted_by,
    mr.created_at AS original_created_at,
    b.organization_id
FROM meter_readings mr
JOIN shift_instances si ON mr.shift_instance_id = si.id
JOIN branches b ON si.branch_id = b.id
WHERE
    -- Only migrate readings associated with backdated entries
    EXISTS (
        SELECT 1 FROM backdated_entries be
        WHERE be.branch_id = si.branch_id
          AND be.business_date = si.date
          AND be.nozzle_id = mr.nozzle_id
    );

-- Show preview
\echo '=== BACKFILL PREVIEW ==='
SELECT
    business_date,
    COUNT(*) AS reading_count,
    COUNT(DISTINCT nozzle_id) AS nozzle_count,
    SUM(CASE WHEN reading_type = 'opening' THEN 1 ELSE 0 END) AS opening_count,
    SUM(CASE WHEN reading_type = 'closing' THEN 1 ELSE 0 END) AS closing_count
FROM backfill_preview
GROUP BY business_date
ORDER BY business_date;

-- Conditional insert (only if DRY_RUN=false)
DO $$
BEGIN
    IF NOT :DRY_RUN THEN
        RAISE NOTICE 'APPLYING BACKFILL...';

        INSERT INTO backdated_meter_readings (
            organization_id,
            branch_id,
            business_date,
            nozzle_id,
            reading_type,
            meter_value,
            source,
            image_url,
            ocr_confidence,
            ocr_manually_edited,
            submitted_by,
            submitted_at,
            created_by,
            created_at,
            updated_at
        )
        SELECT
            bp.organization_id,
            bp.branch_id,
            bp.business_date,
            bp.nozzle_id,
            bp.reading_type,
            bp.meter_value,
            CASE WHEN bp.is_manual_reading THEN 'manual' ELSE 'ocr' END AS source,
            bp.image_url,
            bp.ocr_confidence,
            false AS ocr_manually_edited,
            bp.submitted_by,
            bp.original_created_at AS submitted_at,
            bp.created_by,
            bp.original_created_at,
            CURRENT_TIMESTAMP
        FROM backfill_preview bp
        ON CONFLICT (branch_id, business_date, nozzle_id, reading_type)
        DO UPDATE SET
            meter_value = EXCLUDED.meter_value,
            updated_at = CURRENT_TIMESTAMP;

        -- Show result
        RAISE NOTICE 'BACKFILL COMPLETE';
        RAISE NOTICE 'Inserted/Updated: % rows', (SELECT COUNT(*) FROM backfill_preview);
    ELSE
        RAISE NOTICE 'DRY RUN MODE - No changes applied';
        RAISE NOTICE 'Set DRY_RUN=false to apply changes';
    END IF;
END $$;

-- Show counts
\echo '=== FINAL COUNTS ==='
SELECT
    'backdated_meter_readings' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT business_date) AS distinct_dates
FROM backdated_meter_readings;

ROLLBACK; -- Always rollback in dry run, commit manually if applying
