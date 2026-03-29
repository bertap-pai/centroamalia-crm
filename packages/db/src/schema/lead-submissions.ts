import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts.js';
import { deals } from './deals.js';

export const leadSubmissionSourceEnum = pgEnum('lead_submission_source', [
  'web',
  'meta',
  'tiktok',
  'import',
]);

export const leadSubmissionStatusEnum = pgEnum('lead_submission_status', [
  'processed',
  'failed',
  'needs_review',
]);

export const leadSubmissions = pgTable(
  'lead_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: leadSubmissionSourceEnum('source').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    // Raw webhook/form payload
    payloadRaw: jsonb('payload_raw').notNull(),
    // Phone after normalisation attempt
    mappedPhoneE164: text('mapped_phone_e164'),
    // Normalised fields after mapping
    mappedFields: jsonb('mapped_fields').$type<Record<string, unknown>>(),
    // Result links
    createdContactId: uuid('created_contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    createdDealId: uuid('created_deal_id').references(() => deals.id, {
      onDelete: 'set null',
    }),
    status: leadSubmissionStatusEnum('status').notNull().default('processed'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    statusIdx: index('lead_submissions_status_idx').on(t.status),
    receivedAtIdx: index('lead_submissions_received_at_idx').on(t.receivedAt),
    contactIdx: index('lead_submissions_contact_idx').on(t.createdContactId),
  }),
);

export type LeadSubmission = typeof leadSubmissions.$inferSelect;
export type NewLeadSubmission = typeof leadSubmissions.$inferInsert;
