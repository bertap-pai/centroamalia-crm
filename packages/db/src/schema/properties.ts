import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts.js';
import { deals } from './deals.js';

export const propertyScopeEnum = pgEnum('property_scope', ['contact', 'deal', 'both']);

export const propertyTypeEnum = pgEnum('property_type', [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
]);

/**
 * Defines the schema for dynamic properties.
 * Options field for select/multiselect: [{ key: string, label: string }]
 */
export const propertyDefinitions = pgTable(
  'property_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(), // stable slug, e.g. 'lead_source'
    label: text('label').notNull(),     // display label, e.g. 'Lead source'
    scope: propertyScopeEnum('scope').notNull(),
    type: propertyTypeEnum('type').notNull(),
    options: jsonb('options')
      .$type<Array<{ key: string; label: string }>>()
      .default([]),
    isRequired: boolean('is_required').notNull().default(false),
    isInternalOnly: boolean('is_internal_only').notNull().default(false),
    isSensitive: boolean('is_sensitive').notNull().default(false),
    position: text('position').notNull().default(''), // for ordering in UI
    group: text('group'),  // optional display group, e.g. 'Atribució', 'Aircall', 'Consulta'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeIdx: index('property_definitions_scope_idx').on(t.scope),
  }),
);

export type PropertyDefinition = typeof propertyDefinitions.$inferSelect;
export type NewPropertyDefinition = typeof propertyDefinitions.$inferInsert;

// Property values stored as text; the API layer casts based on property type
export const contactPropertyValues = pgTable(
  'contact_property_values',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    propertyDefinitionId: uuid('property_definition_id')
      .notNull()
      .references(() => propertyDefinitions.id, { onDelete: 'cascade' }),
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.contactId, t.propertyDefinitionId] }),
    contactIdx: index('contact_property_values_contact_idx').on(t.contactId),
  }),
);

export type ContactPropertyValue = typeof contactPropertyValues.$inferSelect;
export type NewContactPropertyValue = typeof contactPropertyValues.$inferInsert;

export const dealPropertyValues = pgTable(
  'deal_property_values',
  {
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    propertyDefinitionId: uuid('property_definition_id')
      .notNull()
      .references(() => propertyDefinitions.id, { onDelete: 'cascade' }),
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.dealId, t.propertyDefinitionId] }),
    dealIdx: index('deal_property_values_deal_idx').on(t.dealId),
  }),
);

export type DealPropertyValue = typeof dealPropertyValues.$inferSelect;
export type NewDealPropertyValue = typeof dealPropertyValues.$inferInsert;
