import { workflowEnrollments, workflowRuns, workflows } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { executeRun } from '../workflow-executor.js';

type Db = FastifyInstance['db'];

export interface EnrollInWorkflowConfig {
  targetWorkflowId: string;
  enrollmentMode?: 'once' | 'once_per_week' | 'every_time';
}

export interface UnenrollFromWorkflowConfig {
  targetWorkflowId: string;
}

export async function executeEnrollInWorkflow(
  db: Db,
  contactId: string,
  config: EnrollInWorkflowConfig,
): Promise<void> {
  // Check target workflow exists and is active
  const [targetWorkflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, config.targetWorkflowId))
    .limit(1);

  if (!targetWorkflow || targetWorkflow.status !== 'active') {
    throw new Error(`enroll_in_workflow: workflow ${config.targetWorkflowId} is not active`);
  }

  // Record enrollment
  await db
    .insert(workflowEnrollments)
    .values({ workflowId: config.targetWorkflowId, contactId })
    .onConflictDoUpdate({
      target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
      set: { lastEnrolledAt: new Date() },
    });

  // Create and start a new run
  const [run] = await db
    .insert(workflowRuns)
    .values({ workflowId: config.targetWorkflowId, contactId, status: 'running' })
    .returning();

  if (run) {
    // Fire-and-forget: executeRun is async but we don't await to avoid blocking current run
    setImmediate(() => executeRun(db, run.id));
  }
}

export async function executeUnenrollFromWorkflow(
  db: Db,
  contactId: string,
  config: UnenrollFromWorkflowConfig,
): Promise<void> {
  // Cancel any running/sleeping runs for this contact+workflow
  await db
    .update(workflowRuns)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(
        eq(workflowRuns.workflowId, config.targetWorkflowId),
        eq(workflowRuns.contactId, contactId),
      ),
    );
}
