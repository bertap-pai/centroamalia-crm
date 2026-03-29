import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  primaryKey,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { contacts } from './contacts.js';
import { pipelines, stages } from './pipelines.js';

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Denormalised from stage for fast filtering/reporting
    isClosedWon: boolean('is_closed_won').notNull().default(false),
    isClosedLost: boolean('is_closed_lost').notNull().default(false),
    // Timestamp of when the deal entered the current stage (for time-in-stage UI)
    currentStageEnteredAt: timestamp('current_stage_entered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // External ID for import deduplication (e.g. HubSpot deal ID)
    externalId: text('external_id'),
    // Soft delete
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    pipelineIdx: index('deals_pipeline_idx').on(t.pipelineId),
    stageIdx: index('deals_stage_idx').on(t.stageId),
    ownerIdx: index('deals_owner_idx').on(t.ownerUserId),
    archivedIdx: index('deals_archived_at_idx').on(t.archivedAt),
    createdAtIdx: index('deals_created_at_idx').on(t.createdAt),
    externalIdIdx: index('deals_external_id_idx').on(t.externalId),
  }),
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

// Many-to-many: contacts ↔ deals
// Exactly one row per deal must have is_primary = true
export const dealContacts = pgTable(
  'deal_contacts',
  {
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    role: text('role'), // optional label e.g. 'patient', 'family'
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.dealId, t.contactId] }),
    dealIdx: index('deal_contacts_deal_idx').on(t.dealId),
    contactIdx: index('deal_contacts_contact_idx').on(t.contactId),
    // Enforced uniqueness of is_primary per deal via partial unique index in migration SQL
  }),
);

export type DealContact = typeof dealContacts.$inferSelect;
export type NewDealContact = typeof dealContacts.$inferInsert;

export const dealStageEventSourceEnum = pgEnum('deal_stage_event_source', [
  'ui',
  'api',
  'import',
]);

// Immutable event log — one row per stage transition
export const dealStageEvents = pgTable(
  'deal_stage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    fromStageId: uuid('from_stage_id').references(() => stages.id, {
      onDelete: 'restrict',
    }), // null for first event
    toStageId: uuid('to_stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: dealStageEventSourceEnum('source').notNull().default('ui'),
  },
  (t) => ({
    dealIdx: index('deal_stage_events_deal_idx').on(t.dealId),
    changedAtIdx: index('deal_stage_events_changed_at_idx').on(t.changedAt),
  }),
);

export type DealStageEvent = typeof dealStageEvents.$inferSelect;
export type NewDealStageEvent = typeof dealStageEvents.$inferInsert;
