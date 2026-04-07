import type { FastifyInstance } from 'fastify';
import { createNotification } from '../notifications.js';

type Db = FastifyInstance['db'];
import { resolveMergeTags, type MergeContext } from '../workflow-merge-tags.js';

export interface SendNotificationConfig {
  userId: string;
  title: string;
  body?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
}

export async function executeSendInternalNotification(
  db: Db,
  contactId: string,
  config: SendNotificationConfig,
  mergeContext: MergeContext,
): Promise<void> {
  const resolvedTitle = resolveMergeTags(config.title, mergeContext);
  const resolvedBody = config.body ? resolveMergeTags(config.body, mergeContext) : null;

  await createNotification(db, {
    user_id: config.userId,
    type: 'workflow_run_completed',
    priority: config.priority ?? 'normal',
    title: resolvedTitle,
    ...(resolvedBody ? { body: resolvedBody } : {}),
    entity_type: 'contact',
    entity_id: contactId,
    created_by: 'workflow_engine',
  });
}
