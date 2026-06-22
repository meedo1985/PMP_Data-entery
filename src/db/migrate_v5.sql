-- migrate_v5.sql — Fix provider_locations data corruption
-- Cause: migrate_v3 rebuilt the providers table (DROP+RENAME). Old location rows
-- whose provider_id happened to match a new provider's id inherited wrongly.

-- Step 1: Remove locations for providers that no longer exist (true orphans)
DELETE FROM provider_locations
WHERE provider_id NOT IN (SELECT id FROM providers);

-- Step 2: Fix PMP specifically — it should only have Gaza.
-- Remove every non-Gaza location that got inherited from a previous provider.
-- NOTE: This step is organization-specific (provider "PMP", location "Gaza").
-- If this codebase is reused by another organization that has a provider named "PMP",
-- this migration will silently remove their non-Gaza locations. Review before deploying elsewhere.
DELETE FROM provider_locations
WHERE provider_id = (SELECT id FROM providers WHERE name = 'PMP' COLLATE NOCASE)
  AND name != 'Gaza';

-- Step 3: Ensure Gaza exists for PMP (in case it was also wiped somehow)
INSERT OR IGNORE INTO provider_locations (provider_id, name, sort_ord)
SELECT id, 'Gaza', 1 FROM providers WHERE name = 'PMP' COLLATE NOCASE;
