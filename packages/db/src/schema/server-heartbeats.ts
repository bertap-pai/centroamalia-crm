import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const serverHeartbeats = pgTable('server_heartbeats', {
  id: text('id').primaryKey(), // fixed row: always "main"
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServerHeartbeat = typeof serverHeartbeats.$inferSelect;
export type NewServerHeartbeat = typeof serverHeartbeats.$inferInsert;
