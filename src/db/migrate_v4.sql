-- migrate_v4.sql — Remove collection_provider_id from orders table
ALTER TABLE orders DROP COLUMN collection_provider_id;
