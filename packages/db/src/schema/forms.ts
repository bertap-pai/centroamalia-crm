import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { contacts } from './contacts.js';

export const formFieldTypeEnum = pgEnum('form_field_type', [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'checkbox',
]);

export const formStatusEnum = pgEnum('form_status', [
  'draft',
  'active',
  'paused',
  'archived',
]);

export const forms = pgTable(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: formStatusEnum('status').notNull().default('draft'),
    submitLabel: text('submit_label').notNull().default('Enviar'),
    successMessage: text('success_message').notNull().default('Gràcies! Hem rebut el teu missatge.'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('forms_status_idx').on(t.status),
    archivedIdx: index('forms_archived_at_idx').on(t.archivedAt),
  }),
);

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;

export const formFields = pgTable(
  'form_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: formFieldTypeEnum('type').notNull().default('text'),
    placeholder: text('placeholder'),
    isRequired: boolean('is_required').notNull().default(false),
    position: integer('position').notNull().default(0),
    options: jsonb('options').$type<Array<{ key: string; label: string }>>().default([]),
    crmPropertyKey: text('crm_property_key'),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    formIdIdx: index('form_fields_form_id_idx').on(t.formId),
    formKeyUniq: unique().on(t.formId, t.key),
  }),
);

export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull().$type<Record<string, string>>().default({}),
    createdContactId: uuid('created_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url'),
    ipHash: text('ip_hash'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    formIdIdx: index('form_submissions_form_id_idx').on(t.formId),
    submittedAtIdx: index('form_submissions_submitted_at_idx').on(t.submittedAt),
  }),
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
