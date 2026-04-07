-- Enums
DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'paused', 'archived', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_trigger_type AS ENUM (
    'contact_created', 'contact_updated', 'contact_deleted',
    'deal_created', 'deal_stage_changed',
    'form_submitted', 'task_completed', 'meeting_scheduled',
    'property_changed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_enrollment_mode AS ENUM ('once', 'every_time');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_step_type AS ENUM (
    'update_contact_property', 'create_task', 'add_tag', 'remove_tag',
    'send_internal_notification', 'webhook', 'wait'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_run_status AS ENUM ('running', 'sleeping', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_step_result AS ENUM ('ok', 'error', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  status            workflow_status NOT NULL DEFAULT 'draft',
  trigger_type      workflow_trigger_type NOT NULL,
  trigger_config    JSONB NOT NULL DEFAULT '{}',
  enrollment_mode   workflow_enrollment_mode NOT NULL DEFAULT 'once',
  filters           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflows_status_idx ON workflows(status);
CREATE INDEX IF NOT EXISTS workflows_trigger_type_idx ON workflows(trigger_type);
CREATE INDEX IF NOT EXISTS workflows_deleted_at_idx ON workflows(deleted_at);

-- Workflow Steps
CREATE TABLE IF NOT EXISTS workflow_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  "order"         INTEGER NOT NULL,
  type            workflow_step_type NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}',
  parent_step_id  UUID,
  branch          VARCHAR(10)
);

CREATE INDEX IF NOT EXISTS workflow_steps_workflow_order_idx ON workflow_steps(workflow_id, "order");

-- Workflow Runs
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE SET NULL,
  status              workflow_run_status NOT NULL DEFAULT 'running',
  last_step_executed  INTEGER,
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS workflow_runs_contact_idx ON workflow_runs(contact_id);
CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS workflow_runs_started_at_idx ON workflow_runs(started_at);

-- Workflow Step Logs (NO PII — metadata only)
CREATE TABLE IF NOT EXISTS workflow_step_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id       UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  step_type     workflow_step_type NOT NULL,
  result        workflow_step_result NOT NULL,
  error_message TEXT,
  output        JSONB,
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_step_logs_run_idx ON workflow_step_logs(run_id);
CREATE INDEX IF NOT EXISTS workflow_step_logs_executed_at_idx ON workflow_step_logs(executed_at);

-- Workflow Enrollments
CREATE TABLE IF NOT EXISTS workflow_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_enrollments_wf_contact_idx
  ON workflow_enrollments(workflow_id, contact_id);

-- Workflow Schedules (for wait steps)
CREATE TABLE IF NOT EXISTS workflow_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  resume_at   TIMESTAMPTZ NOT NULL,
  resumed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_schedules_resume_at_idx ON workflow_schedules(resume_at);
CREATE INDEX IF NOT EXISTS workflow_schedules_run_idx ON workflow_schedules(run_id);

-- Contact Tags (used by add_tag/remove_tag workflow steps)
CREATE TABLE IF NOT EXISTS contact_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_contact_tag_idx ON contact_tags(contact_id, tag);
CREATE INDEX IF NOT EXISTS contact_tags_tag_idx ON contact_tags(tag);
