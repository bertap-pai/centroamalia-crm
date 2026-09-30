import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.GOOGLE_CLIENT_SECRET = 'test';

const { authorized, parseBooking } = await import('../routes/booking-ingress.js');

const booking = {
  booking_id: 'doctoralia-123',
  patient: { name: 'Persona', surname: 'Prova', email: 'patient@example.test', phone: '600 111 222' },
  service: 'Fisioterapia',
  professional: 'Professional de prova',
  starts_at: '2026-10-01T10:00:00+02:00',
  source: 'google',
  marketing_attribution_consented: true,
  attribution: { gclid: 'CLICK-1', first_gclid: 'CLICK-1', utm_source: 'google' },
  is_test: true,
};

test('accepts a confirmed booking with offset and normalized phone', () => {
  const parsed = parseBooking(booking);
  assert.equal(parsed?.phone, '+34600111222');
  assert.equal(parsed?.startsAt.toISOString(), '2026-10-01T08:00:00.000Z');
  assert.equal(parsed?.attribution.first_gclid, 'CLICK-1');
});

test('drops tracking fields without marketing consent', () => {
  const parsed = parseBooking({ ...booking, marketing_attribution_consented: false });
  assert.deepEqual(parsed?.attribution, {});
});

test('rejects invalid booking and timestamps without timezone', () => {
  assert.equal(parseBooking({ ...booking, starts_at: '2026-10-01T10:00:00' }), null);
  assert.equal(parseBooking({ ...booking, booking_id: '' }), null);
  assert.equal(parseBooking({ ...booking, patient: { ...booking.patient, phone: 'not-a-phone' } }), null);
});

test('requires the exact bearer secret', () => {
  const secret = 'x'.repeat(32);
  assert.equal(authorized(`Bearer ${secret}`, secret), true);
  assert.equal(authorized(`Bearer ${'y'.repeat(32)}`, secret), false);
  assert.equal(authorized(`Bearer ${secret}`, 'short'), false);
});
