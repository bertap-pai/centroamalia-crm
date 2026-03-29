import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const externalIdentifierObjectTypeEnum = pgEnum('external_identifier_object_type', [
  'contact',
  'deal',
  'submission',
]);

/**
 * Generic table for external system IDs (HubSpot, Aircall, TikTok, etc.).
 * Avoids polluting property_definitions with system-specific ID fields.
 */
export const externalIdentifiers = pgTable(
  'external_identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectType: externalIdentifierObjectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    source: text('source').notNull(), // 'hubspot', 'aircall', 'meta', 'tiktok', etc.
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    objectIdx: index('external_identifiers_object_idx').on(t.objectType, t.objectId),
    sourceExternalUniq: uniqueIndex('external_identifiers_source_external_uniq').on(
      t.source,
      t.externalId,
      t.objectType,
    ),
  }),
);

export type ExternalIdentifier = typeof externalIdentifiers.$inferSelect;
export type NewExternalIdentifier = typeof externalIdentifiers.$inferInsert;

export const savedViewObjectTypeEnum = pgEnum('saved_view_object_type', ['contact', 'deal']);

/**
 * Persisted list/kanban view configurations.
 * is_team=false → personal view (created_by_user_id)
 * is_team=true  → team view (admin can create/edit)
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    objectType: savedViewObjectTypeEnum('object_type').notNull(),
    // JSON config: { filters, columns, sort, ... }
    config: jsonb('config').notNull(),
    isTeam: boolean('is_team').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('saved_views_user_idx').on(t.createdByUserId),
    teamIdx: index('saved_views_team_idx').on(t.isTeam, t.objectType),
  }),
);

export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;
