import { pgTable, text, uuid, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { contacts } from './contacts.js';
import { deals } from './deals.js';

export const bookingImports = pgTable('booking_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerBookingId: text('provider_booking_id').notNull().unique(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'restrict' }),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'restrict' }),
  service: text('service').notNull(),
  professional: text('professional').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('confirmed'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  currentProviderBookingId: text('current_provider_booking_id').notNull(),
  source: text('source'),
  attribution: jsonb('attribution').$type<Record<string, string>>().notNull().default({}),
  isTest: boolean('is_test').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index('booking_imports_contact_idx').on(t.contactId),
  dealIdx: index('booking_imports_deal_idx').on(t.dealId),
}));

export const bookingAliases = pgTable('booking_aliases', {
  providerBookingId: text('provider_booking_id').primaryKey(),
  bookingImportId: uuid('booking_import_id').notNull().references(() => bookingImports.id, { onDelete: 'cascade' }),
});

export const bookingStatusEvents = pgTable('booking_status_events', {
  eventId: text('event_id').primaryKey(),
  providerBookingId: text('provider_booking_id').notNull(),
  status: text('status').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  newProviderBookingId: text('new_provider_booking_id'),
  newStartsAt: timestamp('new_starts_at', { withTimezone: true }),
  payloadHash: text('payload_hash').notNull(),
  resolution: text('resolution').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bookingIdx: index('booking_status_events_booking_idx').on(t.providerBookingId, t.occurredAt),
}));
