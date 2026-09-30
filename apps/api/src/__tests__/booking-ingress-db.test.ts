import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const sql = postgres(url);
const [stage] = await sql`
  SELECT s.id AS stage_id, p.id AS pipeline_id
  FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
  WHERE p.slug = 'leads' AND NOT s.is_closed_won AND NOT s.is_closed_lost
  ORDER BY s.position LIMIT 1
`;
if (!stage) throw new Error('No open leads stage in test database');

process.env.DATABASE_URL = url;
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.GOOGLE_CLIENT_SECRET = 'test';
process.env.CRM_BOOKING_INGRESS_SECRET = 'test-booking-secret-with-at-least-32-characters';
process.env.DOCTORALIA_DEFAULT_PIPELINE_ID = stage.pipeline_id;
process.env.DOCTORALIA_DEFAULT_STAGE_ID = stage.stage_id;

const { default: dbPlugin } = await import('../plugins/db.js');
const { default: bookingIngressRoutes } = await import('../routes/booking-ingress.js');
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
  attribution: { first_gclid: 'TEST-CLICK', utm_source: 'google' },
  is_test: true,
};
const endpoint = '/api/integrations/doctoralia/bookings';
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
    const [untracked] = await sql`SELECT attribution FROM booking_imports WHERE provider_booking_id = ${noConsentId}`;
    assert.deepEqual(untracked?.attribution, {});

    const concurrentId = `integration-test-concurrent-${randomUUID()}`;
    const concurrentPayload = { ...body, booking_id: concurrentId };
    const concurrent = await Promise.all([
      app.inject({ method: 'POST', url: endpoint, headers, payload: concurrentPayload }),
      app.inject({ method: 'POST', url: endpoint, headers, payload: concurrentPayload }),
    ]);
    assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [200, 201]);
    const [single] = await sql`SELECT count(*)::int AS total FROM booking_imports WHERE provider_booking_id = ${concurrentId}`;
    assert.equal(single?.total, 1);
  } finally {
    await app.close();
    await sql.end();
  }
});
