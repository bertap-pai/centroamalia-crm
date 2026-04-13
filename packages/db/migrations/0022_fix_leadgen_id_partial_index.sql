-- Fix: replace partial unique index with a regular unique index on leadgen_id.
-- The partial index (WHERE leadgen_id IS NOT NULL) caused ON CONFLICT (leadgen_id)
-- to fail because PostgreSQL requires the WHERE predicate in the ON CONFLICT clause
-- to match a partial unique index. A regular unique index works because PostgreSQL
-- treats NULLs as distinct, so non-Meta rows with leadgen_id = NULL are unaffected.
DROP INDEX IF EXISTS lead_submissions_leadgen_id_uniq;

CREATE UNIQUE INDEX lead_submissions_leadgen_id_uniq
  ON lead_submissions (leadgen_id);
