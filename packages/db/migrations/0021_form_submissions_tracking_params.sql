-- IF NOT EXISTS: production already has this change (applied manually before the
-- migration entered the journal), so re-running must be a no-op.
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS tracking_params jsonb;
