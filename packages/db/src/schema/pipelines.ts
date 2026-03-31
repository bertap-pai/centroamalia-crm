import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // 'leads' | 'pacients' | 'bd'
  position: integer('position').notNull().default(0),
  defaultView: text('default_view').notNull().default('list'), // 'list' | 'kanban'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;

/**
 * `required_fields` JSONB: array of field keys that must be non-null before
 * a deal can be moved to this stage.
 * e.g. ["owner_user_id", "interaction_channel"]
 */
export const stages = pgTable(
  'stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
    // Flags for closed-won / closed-lost semantics
    isClosedWon: boolean('is_closed_won').notNull().default(false),
    isClosedLost: boolean('is_closed_lost').notNull().default(false),
    // Array of property keys required to be filled before entering this stage
    requiredFields: jsonb('required_fields').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pipelineIdx: index('stages_pipeline_idx').on(t.pipelineId),
    pipelineSlugUniq: index('stages_pipeline_slug_uniq').on(t.pipelineId, t.slug),
  }),
);

export type Stage = typeof stages.$inferSelect;
export type NewStage = typeof stages.$inferInsert;
