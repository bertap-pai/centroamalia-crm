import { eq, and, isNull } from 'drizzle-orm';
import {
  workflows,
  workflowRuns,
  workflowEnrollments,
  type Workflow,
  type FilterGroup,
} from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eventBus, type CrmEventMap, type CrmEventType } from '../lib/event-bus.js';

type Db = FastifyInstance['db'];
import { evaluateFilters } from './workflow-filter.js';
import { executeRun } from './workflow-executor.js';

// ── Workflow cache ─────────────────────────────────────────────────────
// Map<triggerType, Workflow[]> — populated on first use, invalidated on publish/pause

let workflowCache: Map<string, Workflow[]> | null = null;

async function getActiveWorkflows(db: Db, triggerType: string): Promise<Workflow[]> {
  if (!workflowCache) {
    await refreshCache(db);
  }
  return workflowCache!.get(triggerType) ?? [];
}

async function refreshCache(db: Db): Promise<void> {
  const activeWorkflows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.status, 'active'), isNull(workflows.deletedAt)));

  workflowCache = new Map();
  for (const wf of activeWorkflows) {
    const list = workflowCache.get(wf.triggerType) ?? [];
    list.push(wf);
    workflowCache.set(wf.triggerType, list);
  }
}

export function invalidateWorkflowCache(): void {
  workflowCache = null;
}

// ── Engine: maps CRM event types to workflow trigger types ─────────────

const EVENT_TO_TRIGGER: Record<CrmEventType, string> = {
  'contact.created': 'contact_created',
  'contact.updated': 'contact_updated',
  'contact.deleted': 'contact_deleted',
  'deal.created': 'deal_created',
  'deal.stage_changed': 'deal_stage_changed',
  'form.submitted': 'form_submitted',
  'task.completed': 'task_completed',
  'meeting.scheduled': 'meeting_scheduled',
  'property.changed': 'property_changed',
};

// ── Trigger config matchers ────────────────────────────────────────────

function matchesTriggerConfig(
  workflow: Workflow,
  eventType: CrmEventType,
  payload: Record<string, unknown>,
): boolean {
  const config = workflow.triggerConfig as Record<string, unknown>;

  switch (eventType) {
    case 'form.submitted':
      // Match specific form_id if configured
      if (config.form_id && config.form_id !== payload.formId) return false;
      break;

    case 'deal.stage_changed':
      // Match specific stage transitions
      if (config.to_stage_id && config.to_stage_id !== payload.toStageId) return false;
      if (config.from_stage_id && config.from_stage_id !== payload.fromStageId) return false;
      if (config.pipeline_id && config.pipeline_id !== payload.pipelineId) return false;
      break;

    case 'property.changed':
      // Match specific property name
      if (config.property && config.property !== payload.property) return false;
      break;

    case 'task.completed':
      // No extra config matching for now
      break;
  }

  return true;
}

// ── Enrollment check ───────────────────────────────────────────────────

async function checkEnrollment(
  db: Db,
  workflowId: string,
  contactId: string,
  mode: string,
): Promise<boolean> {
  if (mode === 'every_time') return true;

  // mode === 'once': skip if already enrolled
  const [existing] = await db
    .select()
    .from(workflowEnrollments)
    .where(
      and(
        eq(workflowEnrollments.workflowId, workflowId),
        eq(workflowEnrollments.contactId, contactId),
      ),
    )
    .limit(1);

  return !existing;
}

async function recordEnrollment(
  db: Db,
  workflowId: string,
  contactId: string,
): Promise<void> {
  await db
    .insert(workflowEnrollments)
    .values({ workflowId, contactId })
    .onConflictDoUpdate({
      target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
      set: { lastEnrolledAt: new Date() },
    });
}

// ── Process a single event ─────────────────────────────────────────────

async function processEvent<E extends CrmEventType>(
  db: Db,
  eventType: E,
  payload: CrmEventMap[E],
): Promise<void> {
  const triggerType = EVENT_TO_TRIGGER[eventType];
  if (!triggerType) return;

  const activeWorkflows = await getActiveWorkflows(db, triggerType);
  if (activeWorkflows.length === 0) return;

  const payloadRecord = payload as Record<string, unknown>;
  const contactId = (payloadRecord.contactId as string) ?? null;
  const dealId = (payloadRecord.dealId as string) ?? null;

  if (!contactId) return;

  for (const workflow of activeWorkflows) {
    try {
      // 1. Check trigger config match
      if (!matchesTriggerConfig(workflow, eventType, payloadRecord)) continue;

      // 2. Evaluate filters
      // For filter evaluation, we pass the payload as context
      // The filter evaluator supports dot notation, so flat payload works
      if (!evaluateFilters(workflow.filters as FilterGroup | null, payloadRecord)) continue;

      // 3. Check enrollment
      const canEnroll = await checkEnrollment(
        db,
        workflow.id,
        contactId,
        workflow.enrollmentMode,
      );
      if (!canEnroll) continue;

      // 4. Record enrollment
      await recordEnrollment(db, workflow.id, contactId);

      // 5. Create workflow run
      const [run] = await db
        .insert(workflowRuns)
        .values({
          workflowId: workflow.id,
          contactId,
          dealId,
          status: 'running',
        })
        .returning();

      if (!run) continue;

      // 6. Execute run (async — don't await to avoid blocking event processing)
      executeRun(db, run.id).catch((err) => {
        console.error(`[workflow-engine] Run ${run.id} failed:`, err);
      });
    } catch (err) {
      console.error(`[workflow-engine] Error processing workflow ${workflow.id}:`, err);
    }
  }
}

// ── Initialize: subscribe to all event bus events ──────────────────────

export function initWorkflowEngine(db: Db): void {
  const eventTypes: CrmEventType[] = [
    'contact.created',
    'contact.updated',
    'contact.deleted',
    'deal.created',
    'deal.stage_changed',
    'form.submitted',
    'task.completed',
    'meeting.scheduled',
    'property.changed',
  ];

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (payload) => {
      processEvent(db, eventType, payload).catch((err) => {
        console.error(`[workflow-engine] Failed to process ${eventType}:`, err);
      });
    });
  }
}
