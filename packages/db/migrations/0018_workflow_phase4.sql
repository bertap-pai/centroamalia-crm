-- Phase 4: AI step types + run variables

-- New step types (IF NOT EXISTS is Postgres 9.6+, safe to use)
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'trigger_agent';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'request_ai_content';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'ai_classify';

-- Run-scoped variable store for inter-step data passing
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_variables jsonb;
