-- Add default_view to pipelines — idempotent
ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS default_view TEXT NOT NULL DEFAULT 'list';
