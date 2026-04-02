-- AlterTable
-- Add custom name field to nozzles for better identification during meter reading
-- Allows names like "D1N2" or "Dispensing Unit 1 Nozzle 2"
ALTER TABLE "nozzles" ADD COLUMN "name" VARCHAR(100);
