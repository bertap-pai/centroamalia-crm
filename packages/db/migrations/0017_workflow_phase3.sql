-- Phase 3: time-based trigger types + workflow_trigger_schedules table

-- Add new trigger types to workflow_trigger_type enum
ALTER TYPE workflow_trigger_type ADD VALUE IF NOT EXISTS 'time_after_event';
ALTER TYPE workflow_trigger_type ADD VALUE IF NOT EXISTS 'time_before_event';
ALTER TYPE workflow_trigger_type ADD VALUE IF NOT EXISTS 'scheduled_recurring';
ALTER TYPE workflow_trigger_type ADD VALUE IF NOT EXISTS 'contact_anniversary';

-- Create workflow_trigger_schedules table for deferred per-contact firings
CREATE TABLE IF NOT EXISTS workflow_trigger_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  trigger_at TIMESTAMPTZ NOT NULL,
  triggered_at TIMESTAMPTZ,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_trigger_schedules_trigger_at_idx ON workflow_trigger_schedules(trigger_at);
CREATE INDEX IF NOT EXISTS workflow_trigger_schedules_wf_contact_idx ON workflow_trigger_schedules(workflow_id, contact_id);
CREATE INDEX IF NOT EXISTS workflow_trigger_schedules_triggered_at_idx ON workflow_trigger_schedules(triggered_at);
