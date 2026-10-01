import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { bookingAliases, bookingImports, bookingStatusEvents } from '@crm/db';

type BookingTx = Parameters<Parameters<FastifyInstance['db']['transaction']>[0]>[0];

export type BookingStatusChange = {
  event_id: string;
  booking_id: string;
  status: 'canceled' | 'moved';
  occurred_at: string;
  new_booking_id?: string;
  new_starts_at?: string;
};

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 120;
}

function zonedDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 40 || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseBookingStatusChange(body: unknown): {
  change: BookingStatusChange; occurredAt: Date; newStartsAt: Date | null; payloadHash: string;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const change = body as BookingStatusChange;
  if (!boundedId(change.event_id) || !boundedId(change.booking_id)) return null;
  if (change.status !== 'canceled' && change.status !== 'moved') return null;
  const occurredAt = zonedDate(change.occurred_at);
  if (!occurredAt) return null;
  if (change.status === 'canceled' && (change.new_booking_id !== undefined || change.new_starts_at !== undefined)) return null;
  if (change.status === 'moved' && (change.new_booking_id !== undefined && !boundedId(change.new_booking_id))) return null;
  const newStartsAt = change.status === 'moved' ? zonedDate(change.new_starts_at) : null;
  if (change.status === 'moved' && !newStartsAt) return null;
  const payloadHash = createHash('sha256').update(JSON.stringify({
    booking_id: change.booking_id,
    status: change.status,
    occurred_at: occurredAt.toISOString(),
    new_booking_id: change.new_booking_id ?? null,
    new_starts_at: newStartsAt?.toISOString() ?? null,
  })).digest('hex');
  return { change, occurredAt, newStartsAt, payloadHash };
}

export async function resolveBookingAlias(tx: BookingTx, providerBookingId: string) {
  const [alias] = await tx.select({ bookingImportId: bookingAliases.bookingImportId })
    .from(bookingAliases).where(eq(bookingAliases.providerBookingId, providerBookingId)).limit(1);
  return alias?.bookingImportId ?? null;
}

export async function reconcileBookingStatus(tx: BookingTx, bookingImportId: string): Promise<void> {
  while (true) {
    const aliases = await tx.select({ providerBookingId: bookingAliases.providerBookingId })
      .from(bookingAliases).where(eq(bookingAliases.bookingImportId, bookingImportId));
    const ids = aliases.map((alias) => alias.providerBookingId);
    if (!ids.length) return;
    const [pending] = await tx.select().from(bookingStatusEvents)
      .where(and(inArray(bookingStatusEvents.providerBookingId, ids), eq(bookingStatusEvents.resolution, 'pending')))
      .orderBy(asc(bookingStatusEvents.occurredAt), asc(bookingStatusEvents.eventId))
      .limit(1);
    if (!pending) return;

    const [booking] = await tx.select().from(bookingImports)
      .where(eq(bookingImports.id, bookingImportId)).limit(1);
    if (!booking) return;
    if (booking.statusChangedAt && pending.occurredAt.getTime() <= booking.statusChangedAt.getTime()) {
      await tx.update(bookingStatusEvents).set({ resolution: pending.occurredAt.getTime() === booking.statusChangedAt.getTime() ? 'conflict' : 'stale' })
        .where(eq(bookingStatusEvents.eventId, pending.eventId));
      continue;
    }
    if (pending.providerBookingId !== booking.currentProviderBookingId) {
      await tx.update(bookingStatusEvents).set({ resolution: 'conflict' })
        .where(eq(bookingStatusEvents.eventId, pending.eventId));
      continue;
    }
    if (pending.status === 'moved') {
      const nextId = pending.newProviderBookingId ?? pending.providerBookingId;
      const claimedBy = await resolveBookingAlias(tx, nextId);
      if (claimedBy && claimedBy !== bookingImportId) {
        await tx.update(bookingStatusEvents).set({ resolution: 'conflict' })
          .where(eq(bookingStatusEvents.eventId, pending.eventId));
        continue;
      }
      if (!claimedBy) await tx.insert(bookingAliases).values({ providerBookingId: nextId, bookingImportId });
      await tx.update(bookingImports).set({
        status: 'moved', statusChangedAt: pending.occurredAt,
        startsAt: pending.newStartsAt!, currentProviderBookingId: nextId,
      }).where(eq(bookingImports.id, bookingImportId));
    } else {
      await tx.update(bookingImports).set({ status: 'canceled', statusChangedAt: pending.occurredAt })
        .where(eq(bookingImports.id, bookingImportId));
    }
    await tx.update(bookingStatusEvents).set({ resolution: 'applied' })
      .where(eq(bookingStatusEvents.eventId, pending.eventId));
  }
}
