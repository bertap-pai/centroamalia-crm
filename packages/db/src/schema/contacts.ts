import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Primary unique key: E.164 phone, +34 default country
    phoneE164: text('phone_e164').unique(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Soft delete
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Dedup review flag: set when incoming lead phone matches but name differs
    possibleIdentityMismatch: boolean('possible_identity_mismatch').notNull().default(false),
  },
  (t) => ({
    phoneIdx: index('contacts_phone_idx').on(t.phoneE164),
    archivedIdx: index('contacts_archived_at_idx').on(t.archivedAt),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
