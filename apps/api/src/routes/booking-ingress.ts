import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  bookingImports,
  contacts,
  contactPropertyValues,
  dealContacts,
  deals,
  dealStageEvents,
  propertyDefinitions,
  stages,
} from '@crm/db';
import { env } from '../env.js';
import { normalizePhone } from '../lib/phone.js';

const ATTRIBUTION_KEYS = [
  'gclid', 'gbraid', 'wbraid', 'fbclid',
  'first_gclid', 'first_gbraid', 'first_wbraid', 'first_fbclid',
  'last_gclid', 'last_gbraid', 'last_wbraid', 'last_fbclid',
  'utm_source', 'utm_medium', 'utm_campaign',
  'first_utm_source', 'first_utm_medium', 'first_utm_campaign',
  'last_utm_source', 'last_utm_medium', 'last_utm_campaign',
  'landing_url', 'referrer', 'captured_at',
] as const;

type BookingBody = {
  booking_id: string;
  patient: { name: string; surname: string; email: string; phone: string };
  service: string;
  professional: string;
  starts_at: string;
  source?: string | null;
  marketing_attribution_consented: boolean;
  attribution?: Record<string, unknown>;
  is_test?: boolean;
};

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function authorized(header: unknown, secret: string): boolean {
  if (secret.length < 32 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseBooking(body: unknown): { booking: BookingBody; phone: string; startsAt: Date; attribution: Record<string, string> } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const booking = body as BookingBody;
  const patient = booking.patient;
  if (!boundedText(booking.booking_id, 120) || !patient || typeof patient !== 'object') return null;
  if (!boundedText(patient.name, 150) || !boundedText(patient.surname, 150)
    || !boundedText(patient.email, 150) || !boundedText(patient.phone, 40)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patient.email)) return null;
  if (!boundedText(booking.service, 150) || !boundedText(booking.professional, 150)) return null;
  if (!boundedText(booking.starts_at, 40) || !/(Z|[+-]\d{2}:\d{2})$/.test(booking.starts_at)) return null;
  const startsAt = new Date(booking.starts_at);
  const phone = normalizePhone(patient.phone);
  if (!phone || Number.isNaN(startsAt.getTime())) return null;
  if (typeof booking.marketing_attribution_consented !== 'boolean') return null;
  if (booking.source != null && !boundedText(booking.source, 120)) return null;
  if (booking.is_test !== undefined && typeof booking.is_test !== 'boolean') return null;
  if (booking.attribution !== undefined && (!booking.attribution || typeof booking.attribution !== 'object' || Array.isArray(booking.attribution))) return null;

  const attribution: Record<string, string> = {};
  if (booking.marketing_attribution_consented) {
    for (const key of ATTRIBUTION_KEYS) {
      const value = booking.attribution?.[key];
      if (value !== undefined && value !== null) {
        if (!boundedText(value, key === 'landing_url' || key === 'referrer' ? 2048 : 512)) return null;
        if (key === 'captured_at' && (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(new Date(value).getTime()))) return null;
        attribution[key] = value.trim();
      }
    }
  }
  return { booking, phone, startsAt, attribution };
}

export default async function bookingIngressRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/integrations/doctoralia/bookings', { bodyLimit: 16_384 }, async (req, reply) => {
    if (env.CRM_BOOKING_INGRESS_SECRET.length < 32) return reply.code(503).send({ error: 'integration_unavailable' });
    if (!authorized(req.headers.authorization, env.CRM_BOOKING_INGRESS_SECRET)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const parsed = parseBooking(req.body);
    if (!parsed) return reply.code(400).send({ error: 'invalid_booking' });
    const { booking, phone, startsAt, attribution } = parsed;
    const pipelineId = env.DOCTORALIA_DEFAULT_PIPELINE_ID;
    const stageId = env.DOCTORALIA_DEFAULT_STAGE_ID;
    if (!pipelineId || !stageId) return reply.code(503).send({ error: 'deal_stage_not_configured' });

    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${booking.booking_id}, 0))`);
      const [existing] = await tx.select().from(bookingImports)
        .where(eq(bookingImports.providerBookingId, booking.booking_id)).limit(1);
      if (existing) {
        const [linked] = await tx.select({ phone: contacts.phoneE164 }).from(contacts)
          .where(eq(contacts.id, existing.contactId)).limit(1);
        return { row: existing, created: false, conflict: linked?.phone !== phone };
      }

      const [inserted] = await tx.insert(contacts).values({
        phoneE164: phone,
        firstName: booking.patient.name.trim(),
        lastName: booking.patient.surname.trim(),
        email: booking.patient.email.trim(),
      }).onConflictDoNothing({ target: contacts.phoneE164 }).returning({ id: contacts.id });
      const [contact] = inserted ? [inserted] : await tx.select({
        id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName,
      }).from(contacts).where(eq(contacts.phoneE164, phone)).limit(1);
      if (!contact) throw new Error('contact_upsert_failed');

      if (!inserted && 'firstName' in contact && (
        (contact.firstName && contact.firstName.toLowerCase() !== booking.patient.name.trim().toLowerCase())
        || (contact.lastName && contact.lastName.toLowerCase() !== booking.patient.surname.trim().toLowerCase())
      )) {
        await tx.update(contacts).set({ possibleIdentityMismatch: true }).where(eq(contacts.id, contact.id));
      }

      const properties: Record<string, string> = {
        first_lead_source: 'doctoralia_booking',
        last_lead_source: 'doctoralia_booking',
      };
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
        const suffix = key.slice(4);
        if (attribution[`first_${key}`] || attribution[key]) properties[`first_utm_${suffix}`] = attribution[`first_${key}`] ?? attribution[key]!;
        if (attribution[`last_${key}`] || attribution[key]) properties[`last_utm_${suffix}`] = attribution[`last_${key}`] ?? attribution[key]!;
      }
      if (attribution.landing_url) {
        properties.first_page_url = attribution.landing_url;
        properties.last_page_url = attribution.landing_url;
      }
      const defs = await tx.select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
        .from(propertyDefinitions).where(inArray(propertyDefinitions.key, Object.keys(properties)));
      for (const def of defs) {
        const value = properties[def.key];
        if (!value) continue;
        const insert = tx.insert(contactPropertyValues).values({
          contactId: contact.id, propertyDefinitionId: def.id, value,
        });
        if (def.key.startsWith('first_')) await insert.onConflictDoNothing();
        else await insert.onConflictDoUpdate({
          target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
          set: { value, updatedAt: new Date() },
        });
      }

      const [stage] = await tx.select({ id: stages.id, isClosedWon: stages.isClosedWon, isClosedLost: stages.isClosedLost })
        .from(stages).where(and(eq(stages.id, stageId), eq(stages.pipelineId, pipelineId))).limit(1);
      if (!stage) throw new Error('doctoralia_stage_not_found');
      const now = new Date();
      const [deal] = await tx.insert(deals).values({
        pipelineId, stageId, ownerUserId: null,
        isClosedWon: stage.isClosedWon, isClosedLost: stage.isClosedLost,
        currentStageEnteredAt: now, createdByUserId: null,
        externalId: `doctoralia:${booking.booking_id}`,
      }).returning({ id: deals.id });
      if (!deal) throw new Error('deal_insert_failed');
      const dealId = deal.id;
      await tx.insert(dealContacts).values({ dealId, contactId: contact.id, isPrimary: true });
      await tx.insert(dealStageEvents).values({
        dealId, pipelineId, fromStageId: null, toStageId: stageId,
        changedAt: now, changedByUserId: null, source: 'api',
      });

      const [row] = await tx.insert(bookingImports).values({
        providerBookingId: booking.booking_id,
        contactId: contact.id,
        dealId,
        service: booking.service.trim(),
        professional: booking.professional.trim(),
        startsAt,
        source: booking.source?.trim() || null,
        attribution: sql`(${JSON.stringify(attribution)}::text)::jsonb`,
        isTest: booking.is_test ?? false,
      }).returning();
      if (!row) throw new Error('booking_insert_failed');
      return { row, created: true, conflict: false };
    });

    if (result.conflict) return reply.code(409).send({ error: 'booking_identity_conflict' });
    return reply.code(result.created ? 201 : 200).send({
      status: result.created ? 'created' : 'duplicate',
      booking_id: result.row.providerBookingId,
      contact_id: result.row.contactId,
      crm_booking_id: result.row.id,
      deal_id: result.row.dealId,
    });
  });
}
