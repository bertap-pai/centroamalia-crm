import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 50 }).notNull(),
  },
  (t) => ({
    userDismissedCreatedIdx: index('notifications_user_dismissed_created_idx').on(
      t.userId,
      t.dismissedAt,
      t.createdAt,
    ),
    userReadIdx: index('notifications_user_read_idx').on(t.userId, t.readAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
