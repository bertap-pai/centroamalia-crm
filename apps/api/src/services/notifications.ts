import { notifications, type Notification } from '@crm/db';
import type { FastifyInstance } from 'fastify';

export type NotificationType =
  | 'workflow_run_failed'
  | 'workflow_engine_error'
  | 'workflow_run_completed'
  | 'task_assigned'
  | 'task_due_soon'
  | 'task_overdue'
  | 'deal_stage_changed'
  | 'contact_assigned'
  | 'system_alert';

export interface CreateNotificationInput {
  user_id: string;
  type: NotificationType;
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string; // max 80 chars
  body?: string;
  entity_type: string;
  entity_id: string;
  created_by: string; // 'workflow_engine' | 'crm_core' | 'system'
}

export async function createNotification(
  db: FastifyInstance['db'],
  input: CreateNotificationInput,
): Promise<Notification> {
  const rows = await db
    .insert(notifications)
    .values({
      userId: input.user_id,
      type: input.type,
      priority: input.priority,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entity_type,
      entityId: input.entity_id,
      createdBy: input.created_by,
    })
    .returning();

  // TODO: push SSE event (Phase 2)

  return rows[0]!;
}
