-- AddColumn localName to QBEntityMapping
ALTER TABLE "qb_entity_mappings" ADD COLUMN "local_name" VARCHAR(255) NULL;
