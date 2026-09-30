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
  source: text('source'),
  attribution: jsonb('attribution').$type<Record<string, string>>().notNull().default({}),
  isTest: boolean('is_test').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index('booking_imports_contact_idx').on(t.contactId),
  dealIdx: index('booking_imports_deal_idx').on(t.dealId),
}));
