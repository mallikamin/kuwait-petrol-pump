-- AlterTable
-- Make nozzleId optional in fuel_sales table
-- Client removed nozzle selection from POS (cannot identify which nozzle relates to customer sale)
ALTER TABLE "fuel_sales" ALTER COLUMN "nozzle_id" DROP NOT NULL;
