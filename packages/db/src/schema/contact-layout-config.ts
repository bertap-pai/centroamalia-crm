import { pgTable, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const contactLayoutConfig = pgTable('contact_layout_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupOrder: jsonb('group_order').$type<string[]>().notNull().default([]),
  pinnedPropertyKeys: jsonb('pinned_property_keys').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContactLayoutConfig = typeof contactLayoutConfig.$inferSelect;
export type NewContactLayoutConfig = typeof contactLayoutConfig.$inferInsert;
