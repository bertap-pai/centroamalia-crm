import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const objectTypeEnum = pgEnum('object_type', ['contact', 'deal']);

export const taskStatusEnum = pgEnum('task_status', ['open', 'done']);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectType: objectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(), // contact.id or deal.id
    body: text('body').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    objectIdx: index('notes_object_idx').on(t.objectType, t.objectId),
  }),
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectType: objectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    title: text('title').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: taskStatusEnum('status').notNull().default('open'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    objectIdx: index('tasks_object_idx').on(t.objectType, t.objectId),
    dueAtIdx: index('tasks_due_at_idx').on(t.dueAt),
    statusIdx: index('tasks_status_idx').on(t.status),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
