import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'archive',
  'restore',
]);

/**
 * Append-only audit trail for contact and deal mutations.
 * stage transitions are tracked separately in deal_stage_events.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: auditActionEnum('action').notNull(),
    objectType: text('object_type').notNull(), // 'contact' | 'deal'
    objectId: uuid('object_id').notNull(),
    diff: jsonb('diff').$type<{ before?: Record<string, unknown>; after?: Record<string, unknown> }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    objectIdx: index('audit_logs_object_idx').on(t.objectType, t.objectId),
    userIdx: index('audit_logs_user_idx').on(t.userId),
    createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
