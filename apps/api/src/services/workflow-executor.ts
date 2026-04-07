import { eq, and, asc, isNull } from 'drizzle-orm';
import {
  workflowRuns,
  workflowSteps,
  workflowStepLogs,
  contacts,
  deals,
  workflows,
  type WorkflowStep,
  type WorkflowRun,
  type FilterGroup,
} from '@crm/db';
import type { FastifyInstance } from 'fastify';
import type { MergeContext } from './workflow-merge-tags.js';

type Db = FastifyInstance['db'];
import { executeUpdateContactProperty, type UpdateContactPropertyConfig } from './step-executors/update-contact-property.js';
import { executeCreateTask, type CreateTaskConfig } from './step-executors/create-task.js';
import { executeAddTag, executeRemoveTag, type TagConfig } from './step-executors/add-remove-tag.js';
import { executeSendInternalNotification, type SendNotificationConfig } from './step-executors/send-internal-notification.js';
import { executeWebhook, type WebhookConfig } from './step-executors/webhook.js';
import { executeWait, type WaitConfig } from './step-executors/wait.js';
import { executeWaitUntil, type WaitUntilConfig } from './step-executors/wait-until.js';
import { executeCreateDeal, type CreateDealConfig } from './step-executors/create-deal.js';
import { executeMoveDealStage, type MoveDealStageConfig } from './step-executors/move-deal-stage.js';
import { executeUpdateDealProperty, type UpdateDealPropertyConfig } from './step-executors/update-deal-property.js';
import { executeAssignOwner, type AssignOwnerConfig } from './step-executors/assign-owner.js';
import {
  executeEnrollInWorkflow,
  executeUnenrollFromWorkflow,
  type EnrollInWorkflowConfig,
  type UnenrollFromWorkflowConfig,
} from './step-executors/enroll-in-workflow.js';
import { createNotification } from './notifications.js';

// Retry schedule: 1min, 5min, 30min
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];

export async function executeRun(db: Db, runId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);

  if (!run || (run.status !== 'running' && run.status !== 'sleeping')) return;

  if (run.status === 'sleeping') {
    await db
      .update(workflowRuns)
      .set({ status: 'running' })
      .where(eq(workflowRuns.id, runId));
  }

  // Only load top-level steps (no parent)
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowId, run.workflowId), isNull(workflowSteps.parentStepId)))
    .orderBy(asc(workflowSteps.order));

  if (steps.length === 0) {
    await db
      .update(workflowRuns)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return;
  }

  const mergeContext = await buildMergeContext(db, run);
  const startIdx = run.lastStepExecuted != null ? run.lastStepExecuted : 0;

  for (let i = startIdx; i < steps.length; i++) {
    const step = steps[i]!;

    // Branch steps are handled specially — no retry logic
    if (step.type === 'branch') {
      const stopped = await executeBranchStep(db, run, step, mergeContext);
      await db
        .update(workflowRuns)
        .set({ lastStepExecuted: i + 1 })
        .where(eq(workflowRuns.id, runId));
      if (stopped) return;
      continue;
    }

    const success = await executeStepWithRetry(db, run, step, mergeContext);

    if (!success) {
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          lastStepExecuted: i,
          errorMessage: `Step ${i} (${step.type}) failed after retries`,
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, runId));
      await notifyFailure(db, run, step, i);
      return;
    }

    await db
      .update(workflowRuns)
      .set({ lastStepExecuted: i + 1 })
      .where(eq(workflowRuns.id, runId));

    if (step.type === 'wait' || step.type === 'wait_until') {
      return; // Run is now sleeping
    }
  }

  await db
    .update(workflowRuns)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

/**
 * Evaluates branch condition, then executes matching child steps.
 * Returns true if execution should pause (a wait/wait_until was hit in the branch).
 */
async function executeBranchStep(
  db: Db,
  run: WorkflowRun,
  branchStep: WorkflowStep,
  mergeContext: MergeContext,
): Promise<boolean> {
  const { evaluateFilters } = await import('./workflow-filter.js');
  const contact = await loadContactRecord(db, run.contactId);
  const config = branchStep.config as { condition?: FilterGroup };
  const tookTrue = config.condition ? evaluateFilters(config.condition, contact) : false;

  // Log the branch decision
  await db.insert(workflowStepLogs).values({
    runId: run.id,
    stepId: branchStep.id,
    stepType: branchStep.type,
    result: 'ok',
    output: { branch: tookTrue ? 'true' : 'false' },
  });

  // Load matching children
  const branchValue = tookTrue ? 'true' : 'false';
  const children = await db
    .select()
    .from(workflowSteps)
    .where(
      and(
        eq(workflowSteps.parentStepId, branchStep.id),
        eq(workflowSteps.branch, branchValue),
      ),
    )
    .orderBy(asc(workflowSteps.order));

  return executeChildSteps(db, run, children, mergeContext);
}

/**
 * Executes a list of child steps sequentially.
 * Returns true if a wait/wait_until step was hit (caller should pause).
 */
async function executeChildSteps(
  db: Db,
  run: WorkflowRun,
  steps: WorkflowStep[],
  mergeContext: MergeContext,
): Promise<boolean> {
  for (const step of steps) {
    const success = await executeStepWithRetry(db, run, step, mergeContext);
    if (!success) {
      await db
        .update(workflowRuns)
        .set({
          status: 'failed',
          errorMessage: `Branch child step (${step.type}) failed after retries`,
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run.id));
      await notifyFailure(db, run, step, -1);
      return true; // stopped
    }
    if (step.type === 'wait' || step.type === 'wait_until') {
      return true; // sleeping
    }
  }
  return false;
}

async function loadContactRecord(db: Db, contactId: string): Promise<Record<string, unknown>> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) return {};
  return {
    first_name: contact.firstName,
    last_name: contact.lastName,
    email: contact.email,
    phone: contact.phoneE164,
  };
}

async function executeStepWithRetry(
  db: Db,
  run: WorkflowRun,
  step: WorkflowStep,
  mergeContext: MergeContext,
): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await executeSingleStep(db, run, step, mergeContext);

      // Log success
      await db.insert(workflowStepLogs).values({
        runId: run.id,
        stepId: step.id,
        stepType: step.type,
        result: 'ok',
        output: { attempt },
      });

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Log error
      await db.insert(workflowStepLogs).values({
        runId: run.id,
        stepId: step.id,
        stepType: step.type,
        result: 'error',
        errorMessage,
        output: { attempt },
      });

      // If we have more retries, wait
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  return false;
}

async function executeSingleStep(
  db: Db,
  run: WorkflowRun,
  step: WorkflowStep,
  mergeContext: MergeContext,
): Promise<void> {
  const config = step.config as Record<string, unknown>;

  switch (step.type) {
    case 'update_contact_property':
      await executeUpdateContactProperty(
        db,
        run.contactId,
        config as unknown as UpdateContactPropertyConfig,
        mergeContext,
      );
      break;

    case 'create_task':
      await executeCreateTask(
        db,
        run.contactId,
        run.dealId,
        config as unknown as CreateTaskConfig,
        mergeContext,
      );
      break;

    case 'add_tag':
      await executeAddTag(db, run.contactId, config as unknown as TagConfig);
      break;

    case 'remove_tag':
      await executeRemoveTag(db, run.contactId, config as unknown as TagConfig);
      break;

    case 'send_internal_notification':
      await executeSendInternalNotification(
        db,
        run.contactId,
        config as unknown as SendNotificationConfig,
        mergeContext,
      );
      break;

    case 'webhook':
      await executeWebhook(
        run.contactId,
        config as unknown as WebhookConfig,
        mergeContext,
      );
      break;

    case 'wait': {
      await executeWait(db, run.id, config as unknown as WaitConfig);
      await db
        .update(workflowRuns)
        .set({ status: 'sleeping' })
        .where(eq(workflowRuns.id, run.id));
      break;
    }

    case 'wait_until': {
      await executeWaitUntil(db, run.id, config as unknown as WaitUntilConfig);
      await db
        .update(workflowRuns)
        .set({ status: 'sleeping' })
        .where(eq(workflowRuns.id, run.id));
      break;
    }

    case 'create_deal':
      await executeCreateDeal(db, run.contactId, config as unknown as CreateDealConfig);
      break;

    case 'move_deal_stage':
      await executeMoveDealStage(db, run.dealId, config as unknown as MoveDealStageConfig);
      break;

    case 'update_deal_property':
      await executeUpdateDealProperty(db, run.dealId, config as unknown as UpdateDealPropertyConfig);
      break;

    case 'assign_owner':
      await executeAssignOwner(
        db,
        run.contactId,
        run.dealId,
        run.workflowId,
        config as unknown as AssignOwnerConfig,
      );
      break;

    case 'enroll_in_workflow':
      await executeEnrollInWorkflow(db, run.contactId, config as unknown as EnrollInWorkflowConfig);
      break;

    case 'unenroll_from_workflow':
      await executeUnenrollFromWorkflow(db, run.contactId, config as unknown as UnenrollFromWorkflowConfig);
      break;

    case 'branch':
      // Handled in executeRun — should not reach here
      break;

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

async function buildMergeContext(db: Db, run: WorkflowRun): Promise<MergeContext> {
  const context: MergeContext = {};

  // Load contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, run.contactId))
    .limit(1);

  if (contact) {
    context.contact = {
      id: contact.id,
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };
  }

  // Load deal if present
  if (run.dealId) {
    const [deal] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, run.dealId))
      .limit(1);

    if (deal) {
      context.deal = {
        id: deal.id,
        pipeline_id: deal.pipelineId,
        stage_id: deal.stageId,
      };
    }
  }

  // Load workflow
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, run.workflowId))
    .limit(1);

  if (workflow) {
    context.workflow = {
      id: workflow.id,
      name: workflow.name,
    };
  }

  return context;
}

async function notifyFailure(
  db: Db,
  run: WorkflowRun,
  step: WorkflowStep,
  stepIndex: number,
): Promise<void> {
  try {
    // Get workflow name for notification
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, run.workflowId))
      .limit(1);

    // We don't know which user to notify — use the first user we find
    // In practice this would be configured per-workflow
    const { users } = await import('@crm/db');
    const [adminUser] = await db.select({ id: users.id }).from(users).limit(1);

    if (adminUser) {
      await createNotification(db, {
        user_id: adminUser.id,
        type: 'workflow_run_failed',
        priority: 'high',
        title: `Workflow "${workflow?.name ?? 'Unknown'}" failed at step ${stepIndex + 1}`,
        body: `Run ${run.id} failed on step type "${step.type}". Check workflow run logs for details.`,
        entity_type: 'workflow_run',
        entity_id: run.id,
        created_by: 'workflow_engine',
      });
    }
  } catch {
    // Don't let notification failure break the flow
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
