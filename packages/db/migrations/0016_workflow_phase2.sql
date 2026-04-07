-- Phase 2: new step types, once_per_week enrollment, wait_until columns

-- Add new step types to workflow_step_type enum
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'branch';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'wait_until';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'create_deal';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'move_deal_stage';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'update_deal_property';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'assign_owner';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'enroll_in_workflow';
ALTER TYPE workflow_step_type ADD VALUE IF NOT EXISTS 'unenroll_from_workflow';

-- Add once_per_week to enrollment mode enum
ALTER TYPE workflow_enrollment_mode ADD VALUE IF NOT EXISTS 'once_per_week';

-- Add condition and timeout_at columns to workflow_schedules (for wait_until)
ALTER TABLE workflow_schedules ADD COLUMN IF NOT EXISTS condition JSONB DEFAULT NULL;
ALTER TABLE workflow_schedules ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMPTZ;
