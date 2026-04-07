import { deals, workflowStepLogs } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

type Db = FastifyInstance['db'];

export interface AssignOwnerConfig {
  target: 'contact' | 'deal';
  mode: 'fixed' | 'round_robin';
  userId?: string;       // required when mode = 'fixed'
  userIds?: string[];    // required when mode = 'round_robin'
}

export async function executeAssignOwner(
  db: Db,
  contactId: string,
  dealId: string | null | undefined,
  workflowId: string,
  config: AssignOwnerConfig,
): Promise<void> {
  let targetUserId: string;

  if (config.mode === 'fixed') {
    if (!config.userId) throw new Error('assign_owner fixed mode requires userId');
    targetUserId = config.userId;
  } else {
    // Round-robin: pick the user with fewest prior assign_owner executions
    const candidateIds = config.userIds ?? [];
    if (candidateIds.length === 0) throw new Error('assign_owner round_robin mode requires userIds array');

    const allLogs = await db
      .select({ output: workflowStepLogs.output })
      .from(workflowStepLogs)
      .where(eq(workflowStepLogs.stepType, 'assign_owner'))
      .limit(10000);

    const assignCounts: Record<string, number> = {};
    for (const id of candidateIds) assignCounts[id] = 0;
    for (const log of allLogs) {
      const output = log.output as Record<string, unknown> | null;
      const assignedTo = output?.assignedTo as string | undefined;
      if (assignedTo && assignCounts[assignedTo] !== undefined) {
        assignCounts[assignedTo]++;
      }
    }

    // Pick user with minimum count; tie-break by index in candidateIds
    targetUserId = candidateIds.reduce((min, id) =>
      (assignCounts[id] ?? 0) < (assignCounts[min] ?? 0) ? id : min,
    )!;
  }

  if (config.target === 'contact') {
    // contacts table has no ownerUserId column yet — log the assignment only
  } else if (config.target === 'deal' && dealId) {
    await db
      .update(deals)
      .set({ ownerUserId: targetUserId, updatedAt: new Date() })
      .where(eq(deals.id, dealId));
  }
}
