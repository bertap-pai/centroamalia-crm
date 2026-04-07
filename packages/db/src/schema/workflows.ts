import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts.js';
import { deals } from './deals.js';

// ── Enums ──────────────────────────────────────────────────────────────

export const workflowStatusEnum = pgEnum('workflow_status', [
  'draft',
  'active',
  'paused',
  'archived',
  'error',
]);

export const workflowTriggerTypeEnum = pgEnum('workflow_trigger_type', [
  'contact_created',
  'contact_updated',
  'contact_deleted',
  'deal_created',
  'deal_stage_changed',
  'form_submitted',
  'task_completed',
  'meeting_scheduled',
  'property_changed',
]);

export const workflowEnrollmentModeEnum = pgEnum('workflow_enrollment_mode', [
  'once',
  'every_time',
]);

export const workflowStepTypeEnum = pgEnum('workflow_step_type', [
  'update_contact_property',
  'create_task',
  'add_tag',
  'remove_tag',
  'send_internal_notification',
  'webhook',
  'wait',
]);

export const workflowRunStatusEnum = pgEnum('workflow_run_status', [
  'running',
  'sleeping',
  'completed',
  'failed',
  'cancelled',
]);

export const workflowStepResultEnum = pgEnum('workflow_step_result', [
  'ok',
  'error',
  'skipped',
]);

// ── Tables ─────────────────────────────────────────────────────────────

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: workflowStatusEnum('status').notNull().default('draft'),
    triggerType: workflowTriggerTypeEnum('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config').notNull().default({}),
    enrollmentMode: workflowEnrollmentModeEnum('enrollment_mode').notNull().default('once'),
    filters: jsonb('filters').$type<FilterGroup | null>().default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('workflows_status_idx').on(t.status),
    triggerTypeIdx: index('workflows_trigger_type_idx').on(t.triggerType),
    deletedAtIdx: index('workflows_deleted_at_idx').on(t.deletedAt),
  }),
);

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    type: workflowStepTypeEnum('type').notNull(),
    config: jsonb('config').notNull().default({}),
    parentStepId: uuid('parent_step_id'),
    branch: varchar('branch', { length: 10 }),
  },
  (t) => ({
    workflowOrderIdx: index('workflow_steps_workflow_order_idx').on(t.workflowId, t.order),
  }),
);

export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type NewWorkflowStep = typeof workflowSteps.$inferInsert;

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    status: workflowRunStatusEnum('status').notNull().default('running'),
    lastStepExecuted: integer('last_step_executed'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    workflowIdx: index('workflow_runs_workflow_idx').on(t.workflowId),
    contactIdx: index('workflow_runs_contact_idx').on(t.contactId),
    statusIdx: index('workflow_runs_status_idx').on(t.status),
    startedAtIdx: index('workflow_runs_started_at_idx').on(t.startedAt),
  }),
);

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

export const workflowStepLogs = pgTable(
  'workflow_step_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id')
      .notNull()
      .references(() => workflowSteps.id, { onDelete: 'cascade' }),
    stepType: workflowStepTypeEnum('step_type').notNull(),
    result: workflowStepResultEnum('result').notNull(),
    errorMessage: text('error_message'),
    // NO PII — metadata only (timing, result code, error message)
    output: jsonb('output'),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('workflow_step_logs_run_idx').on(t.runId),
    executedAtIdx: index('workflow_step_logs_executed_at_idx').on(t.executedAt),
  }),
);

export type WorkflowStepLog = typeof workflowStepLogs.$inferSelect;
export type NewWorkflowStepLog = typeof workflowStepLogs.$inferInsert;

export const workflowEnrollments = pgTable(
  'workflow_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    lastEnrolledAt: timestamp('last_enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workflowContactIdx: uniqueIndex('workflow_enrollments_wf_contact_idx').on(
      t.workflowId,
      t.contactId,
    ),
  }),
);

export type WorkflowEnrollment = typeof workflowEnrollments.$inferSelect;
export type NewWorkflowEnrollment = typeof workflowEnrollments.$inferInsert;

// Scheduler table for wait steps
export const workflowSchedules = pgTable(
  'workflow_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    resumeAt: timestamp('resume_at', { withTimezone: true }).notNull(),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    resumeAtIdx: index('workflow_schedules_resume_at_idx').on(t.resumeAt),
    runIdx: index('workflow_schedules_run_idx').on(t.runId),
  }),
);

export type WorkflowSchedule = typeof workflowSchedules.$inferSelect;
export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

// Contact tags table (needed for add_tag / remove_tag steps)
export const contactTags = pgTable(
  'contact_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contactTagUniq: uniqueIndex('contact_tags_contact_tag_idx').on(t.contactId, t.tag),
    tagIdx: index('contact_tags_tag_idx').on(t.tag),
  }),
);

export type ContactTag = typeof contactTags.$inferSelect;
export type NewContactTag = typeof contactTags.$inferInsert;

// ── Filter types ───────────────────────────────────────────────────────

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'is_known'
  | 'is_unknown'
  | 'in_list'
  | 'not_in_list';

export interface FilterCondition {
  property: string;
  operator: FilterOperator;
  value?: string | string[];
}

export interface FilterGroup {
  logic: 'and' | 'or';
  conditions: (FilterCondition | FilterGroup)[];
}
