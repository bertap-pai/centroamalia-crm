-- Add external_id to deals for import deduplication — idempotent

ALTER TABLE deals ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS deals_external_id_idx ON deals(external_id) WHERE external_id IS NOT NULL;
