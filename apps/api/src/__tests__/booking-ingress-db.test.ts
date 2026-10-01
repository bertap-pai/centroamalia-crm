import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const sql = postgres(url);
const [stage] = await sql`
  SELECT s.id AS stage_id, p.id AS pipeline_id, s.name AS stage_name
  FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
  WHERE p.id = '00000000-0000-0000-0000-000000000001'
    AND s.id = '00000000-0000-0000-0001-000000000001'
`;
if (!stage) throw new Error('Nou Lead stage missing from test database');
assert.equal(stage.stage_name, 'Nou Lead');

process.env.DATABASE_URL = url;
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.GOOGLE_CLIENT_SECRET = 'test';
process.env.CRM_BOOKING_INGRESS_SECRET = 'test-booking-secret-with-at-least-32-characters';
process.env.DOCTORALIA_DEFAULT_PIPELINE_ID = stage.pipeline_id;
process.env.DOCTORALIA_DEFAULT_STAGE_ID = stage.stage_id;

const { default: dbPlugin } = await import('../plugins/db.js');
const { default: bookingIngressRoutes } = await import('../routes/booking-ingress.js');
const { env } = await import('../env.js');
const app = Fastify();
await app.register(dbPlugin);
await app.register(bookingIngressRoutes);

const body = {
  booking_id: `integration-test-doctoralia-${randomUUID()}`,
  patient: { name: 'Persona', surname: 'Prova', email: 'booking@example.test', phone: '+34600111222' },
  service: 'Fisioterapia',
  professional: 'Professional de prova',
  starts_at: '2026-10-01T10:00:00+02:00',
  source: 'google',
  marketing_attribution_consented: true,
  attribution: {
    first_gclid: 'TEST-CLICK', utm_source: 'google',
    first_landing_url: 'https://centroamalia.com/serveis/fisioterapia',
    last_landing_url: 'https://centroamalia.com/reserva',
  },
  is_test: true,
};
const endpoint = '/api/integrations/doctoralia/bookings';
const statusEndpoint = '/api/integrations/doctoralia/bookings/status';
const headers = { authorization: `Bearer ${process.env.CRM_BOOKING_INGRESS_SECRET}` };

test('booking ingress is atomic and idempotent, including the deal', async () => {
  try {
    const denied = await app.inject({ method: 'POST', url: endpoint, payload: body });
    assert.equal(denied.statusCode, 401);

    const first = await app.inject({ method: 'POST', url: endpoint, headers, payload: body });
    assert.equal(first.statusCode, 201, first.body);
    const created = first.json();
    assert.equal(created.status, 'created');
    assert.ok(created.contact_id && created.crm_booking_id && created.deal_id);

    const second = await app.inject({ method: 'POST', url: endpoint, headers, payload: body });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().status, 'duplicate');
    assert.deepEqual(second.json(), { ...created, status: 'duplicate' });

    const conflict = await app.inject({
      method: 'POST', url: endpoint, headers,
      payload: { ...body, patient: { ...body.patient, phone: '+34600999888' } },
    });
    assert.equal(conflict.statusCode, 409);

    const [counts] = await sql`
      SELECT count(*)::int AS bookings,
             count(DISTINCT contact_id)::int AS contacts,
             count(DISTINCT deal_id)::int AS deals
      FROM booking_imports WHERE provider_booking_id = ${body.booking_id}
    `;
    assert.deepEqual(counts, { bookings: 1, contacts: 1, deals: 1 });
    const leadSources = await sql`
      SELECT pd.key, cpv.value
      FROM contact_property_values cpv
      JOIN property_definitions pd ON pd.id = cpv.property_definition_id
      WHERE cpv.contact_id = ${created.contact_id}
        AND pd.key IN ('first_lead_source', 'last_lead_source')
      ORDER BY pd.key
    `;
    assert.deepEqual(leadSources.map(({ key, value }) => [key, value]), [
      ['first_lead_source', 'google'],
      ['last_lead_source', 'google'],
    ]);
    const [pageUrl] = await sql`
      SELECT cpv.value
      FROM contact_property_values cpv
      JOIN property_definitions pd ON pd.id = cpv.property_definition_id
      WHERE cpv.contact_id = ${created.contact_id} AND pd.key = 'first_page_url'
    `;
    assert.equal(pageUrl?.value, 'https://centroamalia.com/serveis/fisioterapia');
    const [lastPageUrl] = await sql`
      SELECT cpv.value FROM contact_property_values cpv
      JOIN property_definitions pd ON pd.id = cpv.property_definition_id
      WHERE cpv.contact_id = ${created.contact_id} AND pd.key = 'last_page_url'
    `;
    assert.equal(lastPageUrl?.value, 'https://centroamalia.com/reserva');
    const [saved] = await sql`SELECT attribution, is_test FROM booking_imports WHERE provider_booking_id = ${body.booking_id}`;
    assert.ok(saved);
    assert.equal(saved.attribution.first_gclid, 'TEST-CLICK');
    assert.equal(saved.is_test, true);

    const noConsentId = `integration-test-no-consent-${randomUUID()}`;
    const noConsent = await app.inject({
      method: 'POST', url: endpoint, headers,
      payload: { ...body, booking_id: noConsentId, marketing_attribution_consented: false },
    });
    assert.equal(noConsent.statusCode, 201, noConsent.body);
    assert.equal(noConsent.json().contact_id, created.contact_id);
    const [untracked] = await sql`SELECT attribution, source FROM booking_imports WHERE provider_booking_id = ${noConsentId}`;
    assert.deepEqual(untracked?.attribution, {});
    assert.equal(untracked?.source, null);

    const concurrentId = `integration-test-concurrent-${randomUUID()}`;
    const concurrentPayload = { ...body, booking_id: concurrentId };
    const concurrent = await Promise.all([
      app.inject({ method: 'POST', url: endpoint, headers, payload: concurrentPayload }),
      app.inject({ method: 'POST', url: endpoint, headers, payload: concurrentPayload }),
    ]);
    assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [200, 201]);
    const [single] = await sql`SELECT count(*)::int AS total FROM booking_imports WHERE provider_booking_id = ${concurrentId}`;
    assert.equal(single?.total, 1);

    const canceledId = `doctoralia-canceled-${randomUUID()}`;
    const canceledBooking = await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...body, booking_id: canceledId } });
    assert.equal(canceledBooking.statusCode, 201, canceledBooking.body);
    const cancel = {
      event_id: `event-${randomUUID()}`, booking_id: canceledId,
      status: 'canceled', occurred_at: '2026-10-01T11:00:00+02:00',
    };
    const canceled = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: cancel });
    assert.equal(canceled.statusCode, 200, canceled.body);
    assert.equal(canceled.json().booking_status, 'canceled');
    const repeated = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: cancel });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().status, 'duplicate');
    const changedEventId = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: { ...cancel, status: 'moved', new_starts_at: '2026-10-02T11:00:00+02:00' } });
    assert.equal(changedEventId.statusCode, 409);
    const older = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: {
      ...cancel, event_id: `event-${randomUUID()}`, occurred_at: '2026-10-01T10:30:00+02:00',
    } });
    assert.equal(older.statusCode, 200);
    assert.equal(older.json().status, 'stale');
    const [canceledDb] = await sql`
      SELECT b.status, b.status_changed_at, d.stage_id
      FROM booking_imports b JOIN deals d ON d.id = b.deal_id
      WHERE b.provider_booking_id = ${canceledId}
    `;
    assert.ok(canceledDb);
    assert.equal(canceledDb.status, 'canceled');
    assert.equal(canceledDb.stage_id, stage.stage_id);

    const sameId = `doctoralia-moved-same-id-${randomUUID()}`;
    assert.equal((await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...body, booking_id: sameId } })).statusCode, 201);
    const sameIdMove = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: {
      event_id: `event-${randomUUID()}`, booking_id: sameId, status: 'moved',
      occurred_at: '2026-10-01T11:30:00+02:00', new_starts_at: '2026-10-04T09:00:00+02:00',
    } });
    assert.equal(sameIdMove.statusCode, 200, sameIdMove.body);
    assert.equal(sameIdMove.json().booking_status, 'moved');
    assert.equal(sameIdMove.json().current_booking_id, sameId);
    assert.equal(sameIdMove.json().starts_at, '2026-10-04T07:00:00.000Z');

    const oldId = `doctoralia-old-${randomUUID()}`;
    const newId = `doctoralia-new-${randomUUID()}`;
    const movedAt = '2026-10-03T12:00:00+02:00';
    const move = {
      event_id: `event-${randomUUID()}`, booking_id: oldId, status: 'moved',
      occurred_at: '2026-10-01T12:00:00+02:00', new_booking_id: newId, new_starts_at: movedAt,
    };
    const beforeCreate = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: move });
    assert.equal(beforeCreate.statusCode, 202);
    const laterCancel = {
      event_id: `event-${randomUUID()}`, booking_id: newId,
      status: 'canceled', occurred_at: '2026-10-01T13:00:00+02:00',
    };
    assert.equal((await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: laterCancel })).statusCode, 202);
    const prematureNewBooking = await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...body, booking_id: newId } });
    assert.equal(prematureNewBooking.statusCode, 409);
    assert.equal(prematureNewBooking.json().error, 'booking_move_unresolved');

    const imported = await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...body, booking_id: oldId } });
    assert.equal(imported.statusCode, 201, imported.body);
    const [movedDb] = await sql`
      SELECT b.status, b.current_provider_booking_id, b.starts_at, count(a.*)::int AS aliases
      FROM booking_imports b JOIN booking_aliases a ON a.booking_import_id = b.id
      WHERE b.provider_booking_id = ${oldId}
      GROUP BY b.id
    `;
    assert.ok(movedDb);
    assert.equal(movedDb.status, 'canceled');
    assert.equal(movedDb.current_provider_booking_id, newId);
    assert.equal(movedDb.aliases, 2);
    assert.equal(new Date(movedDb.starts_at).toISOString(), new Date(movedAt).toISOString());
    const replayNewId = await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...body, booking_id: newId } });
    assert.equal(replayNewId.statusCode, 200);
    assert.equal(replayNewId.json().booking_id, newId);
    assert.equal(replayNewId.json().deal_id, imported.json().deal_id);
    assert.equal((await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: move })).json().status, 'duplicate');
    const [noExtraDeals] = await sql`SELECT count(*)::int AS count FROM deals WHERE external_id IN (${`doctoralia:${oldId}`}, ${`doctoralia:${newId}`})`;
    assert.ok(noExtraDeals);
    assert.equal(noExtraDeals.count, 1);

    const unknownId = `doctoralia-unknown-${randomUUID()}`;
    const unknown = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: {
      event_id: `event-${randomUUID()}`, booking_id: unknownId,
      status: 'canceled', occurred_at: '2026-10-01T14:00:00+02:00',
    } });
    assert.equal(unknown.statusCode, 202);
    const [unknownCount] = await sql`SELECT count(*)::int AS count FROM booking_imports WHERE provider_booking_id = ${unknownId}`;
    assert.ok(unknownCount);
    assert.equal(unknownCount.count, 0);

    const transient = { event_id: `event-${randomUUID()}`, booking_id: canceledId,
      status: 'canceled', occurred_at: '2026-10-01T15:00:00+02:00' };
    const mutableEnv = env as { CRM_BOOKING_INGRESS_SECRET: string };
    const secret = mutableEnv.CRM_BOOKING_INGRESS_SECRET;
    try {
      mutableEnv.CRM_BOOKING_INGRESS_SECRET = '';
      const unavailable = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: transient });
      assert.equal(unavailable.statusCode, 503);
    } finally {
      mutableEnv.CRM_BOOKING_INGRESS_SECRET = secret;
    }
    const retry = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: transient });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().booking_status, 'canceled');
    const naive = await app.inject({ method: 'POST', url: statusEndpoint, headers, payload: {
      ...transient, event_id: `event-${randomUUID()}`, occurred_at: '2026-10-01T16:00:00',
    } });
    assert.equal(naive.statusCode, 400);
  } finally {
    await app.close();
    await sql.end();
  }
});
