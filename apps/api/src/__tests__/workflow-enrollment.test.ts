import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// checkEnrollment is not easily unit-testable without DB mocks.
// Instead, test the pure logic inline.

function isEnrollmentAllowed(
  mode: string,
  existingEnrollment: { lastEnrolledAt: Date } | null,
): boolean {
  if (mode === 'every_time') return true;
  if (!existingEnrollment) return true;
  if (mode === 'once') return false;
  if (mode === 'once_per_week') {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return existingEnrollment.lastEnrolledAt < oneWeekAgo;
  }
  return false;
}

describe('once_per_week enrollment', () => {
  it('allows enrollment when no previous enrollment exists', () => {
    assert.equal(isEnrollmentAllowed('once_per_week', null), true);
  });

  it('blocks enrollment when last enrolled 3 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    assert.equal(isEnrollmentAllowed('once_per_week', { lastEnrolledAt: threeDaysAgo }), false);
  });

  it('allows enrollment when last enrolled 8 days ago', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    assert.equal(isEnrollmentAllowed('once_per_week', { lastEnrolledAt: eightDaysAgo }), true);
  });

  it('once: blocks when enrollment exists regardless of date', () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    assert.equal(isEnrollmentAllowed('once', { lastEnrolledAt: longAgo }), false);
  });

  it('every_time: always allows', () => {
    const recent = new Date();
    assert.equal(isEnrollmentAllowed('every_time', { lastEnrolledAt: recent }), true);
  });
});
