-- Add leadgen_id column for Meta Lead Ads deduplication
ALTER TABLE lead_submissions ADD COLUMN leadgen_id TEXT;

-- Unique index to prevent duplicate processing of the same Meta lead
-- NULLs are treated as distinct by PostgreSQL, so non-Meta submissions are unaffected
CREATE UNIQUE INDEX lead_submissions_leadgen_id_uniq
  ON lead_submissions (leadgen_id);
