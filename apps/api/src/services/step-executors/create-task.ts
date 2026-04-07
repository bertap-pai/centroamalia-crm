import { tasks } from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

type Db = FastifyInstance['db'];

export interface CreateTaskConfig {
  title: string;
  dueInDays?: number;
  assignToUserId?: string;
  objectType?: 'contact' | 'deal';
}

export async function executeCreateTask(
  db: Db,
  contactId: string,
  dealId: string | null,
  config: CreateTaskConfig,
  mergeContext: MergeContext,
): Promise<void> {
  const resolvedTitle = resolveMergeTags(config.title, mergeContext);

  const dueAt = config.dueInDays
    ? new Date(Date.now() + config.dueInDays * 24 * 60 * 60 * 1000)
    : null;

  const objectType = config.objectType === 'deal' && dealId ? 'deal' : 'contact';
  const objectId = objectType === 'deal' ? dealId! : contactId;

  await db.insert(tasks).values({
    title: resolvedTitle,
    objectType,
    objectId,
    dueAt,
    assignedToUserId: config.assignToUserId ?? null,
    status: 'open',
  });
}
