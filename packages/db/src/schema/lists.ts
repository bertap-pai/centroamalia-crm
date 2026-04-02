import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';

export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    objectType: text('object_type').notNull(),
    kind: text('kind').notNull().default('static'),
    criteria: jsonb('criteria'),
    isTeam: boolean('is_team').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    objectTypeIdx: index('lists_object_type_idx').on(t.objectType),
    archivedIdx: index('lists_archived_at_idx').on(t.archivedAt),
  }),
);

export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;

export const listMemberships = pgTable(
  'list_memberships',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.listId, t.objectId] }),
    listIdx: index('list_memberships_list_idx').on(t.listId),
    objectIdx: index('list_memberships_object_idx').on(t.objectId),
  }),
);

export type ListMembership = typeof listMemberships.$inferSelect;
export type NewListMembership = typeof listMemberships.$inferInsert;

export const listsRelations = relations(lists, ({ many }) => ({
  memberships: many(listMemberships),
}));

export const listMembershipsRelations = relations(listMemberships, ({ one }) => ({
  list: one(lists, {
    fields: [listMemberships.listId],
    references: [lists.id],
  }),
}));
