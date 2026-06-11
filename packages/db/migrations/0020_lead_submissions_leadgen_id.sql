-- Add leadgen_id column for Meta Lead Ads deduplication
-- IF NOT EXISTS: production already has this change (applied manually before the
-- migration entered the journal), so re-running must be a no-op.
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS leadgen_id TEXT;

-- Unique index to prevent duplicate processing of the same Meta lead
-- WHERE clause excludes NULLs so non-Meta submissions are unaffected
CREATE UNIQUE INDEX IF NOT EXISTS lead_submissions_leadgen_id_uniq
  ON lead_submissions (leadgen_id)
  WHERE leadgen_id IS NOT NULL;
