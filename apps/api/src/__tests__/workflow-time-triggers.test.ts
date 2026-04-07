import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pure helper tested in isolation
function calculateTriggerAt(config: {
  daysAfter?: number;
  hoursAfter?: number;
  minutesAfter?: number;
}, baseTime: Date): Date {
  let totalMs = 0;
  if (config.daysAfter) totalMs += config.daysAfter * 24 * 60 * 60 * 1000;
  if (config.hoursAfter) totalMs += config.hoursAfter * 60 * 60 * 1000;
  if (config.minutesAfter) totalMs += config.minutesAfter * 60 * 1000;
  if (totalMs === 0) totalMs = 24 * 60 * 60 * 1000; // default 1 day
  return new Date(baseTime.getTime() + totalMs);
}

describe('calculateTriggerAt', () => {
  const base = new Date('2026-04-07T12:00:00Z');

  it('calculates days after correctly', () => {
    const result = calculateTriggerAt({ daysAfter: 3 }, base);
    assert.equal(result.toISOString(), '2026-04-10T12:00:00.000Z');
  });

  it('calculates hours after correctly', () => {
    const result = calculateTriggerAt({ hoursAfter: 6 }, base);
    assert.equal(result.toISOString(), '2026-04-07T18:00:00.000Z');
  });

  it('combines days and hours', () => {
    const result = calculateTriggerAt({ daysAfter: 1, hoursAfter: 12 }, base);
    assert.equal(result.toISOString(), '2026-04-09T00:00:00.000Z');
  });

  it('defaults to 1 day when no duration specified', () => {
    const result = calculateTriggerAt({}, base);
    assert.equal(result.toISOString(), '2026-04-08T12:00:00.000Z');
  });
});
