import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFilters } from '../services/workflow-filter.js';
import type { FilterGroup } from '@crm/db';

describe('evaluateFilters', () => {
  const contact = {
    first_name: 'Anna',
    last_name: 'Garcia',
    email: 'anna@example.com',
    phone: '+34612345678',
    city: 'Barcelona',
    status: 'active',
  };

  it('returns true when filters is null', () => {
    assert.equal(evaluateFilters(null, contact), true);
  });

  it('returns true when filters is undefined', () => {
    assert.equal(evaluateFilters(undefined, contact), true);
  });

  it('returns true when conditions array is empty', () => {
    assert.equal(evaluateFilters({ logic: 'and', conditions: [] }, contact), true);
  });

  // ── equals ──────────────────────────────────────────────────────────

  it('equals: matches when values are the same', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'first_name', operator: 'equals', value: 'Anna' }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('equals: fails when values differ', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'first_name', operator: 'equals', value: 'Maria' }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── not_equals ──────────────────────────────────────────────────────

  it('not_equals: passes when values differ', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'city', operator: 'not_equals', value: 'Madrid' }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('not_equals: fails when values match', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'city', operator: 'not_equals', value: 'Barcelona' }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── is_known / is_unknown ───────────────────────────────────────────

  it('is_known: passes when field has a value', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'email', operator: 'is_known' }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('is_known: fails when field is undefined', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'missing_field', operator: 'is_known' }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  it('is_unknown: passes when field is undefined', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'missing_field', operator: 'is_unknown' }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('is_unknown: passes when field is empty string', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'notes', operator: 'is_unknown' }],
    };
    assert.equal(evaluateFilters(filters, { ...contact, notes: '' }), true);
  });

  it('is_unknown: fails when field has a value', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'email', operator: 'is_unknown' }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── in_list / not_in_list ───────────────────────────────────────────

  it('in_list: passes when value is in the list', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'status', operator: 'in_list', value: ['active', 'pending'] }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('in_list: fails when value is not in the list', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'status', operator: 'in_list', value: ['inactive', 'pending'] }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  it('not_in_list: passes when value is not in the list', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'status', operator: 'not_in_list', value: ['inactive', 'pending'] }],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('not_in_list: fails when value is in the list', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'status', operator: 'not_in_list', value: ['active', 'pending'] }],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── AND logic ───────────────────────────────────────────────────────

  it('AND: passes when all conditions match', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [
        { property: 'first_name', operator: 'equals', value: 'Anna' },
        { property: 'city', operator: 'equals', value: 'Barcelona' },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('AND: fails when one condition does not match', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [
        { property: 'first_name', operator: 'equals', value: 'Anna' },
        { property: 'city', operator: 'equals', value: 'Madrid' },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── OR logic ────────────────────────────────────────────────────────

  it('OR: passes when at least one condition matches', () => {
    const filters: FilterGroup = {
      logic: 'or',
      conditions: [
        { property: 'city', operator: 'equals', value: 'Madrid' },
        { property: 'city', operator: 'equals', value: 'Barcelona' },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('OR: fails when no conditions match', () => {
    const filters: FilterGroup = {
      logic: 'or',
      conditions: [
        { property: 'city', operator: 'equals', value: 'Madrid' },
        { property: 'city', operator: 'equals', value: 'Valencia' },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── Nested groups ───────────────────────────────────────────────────

  it('supports nested filter groups', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [
        { property: 'status', operator: 'equals', value: 'active' },
        {
          logic: 'or',
          conditions: [
            { property: 'city', operator: 'equals', value: 'Madrid' },
            { property: 'city', operator: 'equals', value: 'Barcelona' },
          ],
        },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), true);
  });

  it('nested group fails correctly', () => {
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [
        { property: 'status', operator: 'equals', value: 'inactive' },
        {
          logic: 'or',
          conditions: [
            { property: 'city', operator: 'equals', value: 'Barcelona' },
          ],
        },
      ],
    };
    assert.equal(evaluateFilters(filters, contact), false);
  });

  // ── Dot notation ────────────────────────────────────────────────────

  it('supports dot notation for nested properties', () => {
    const record = { contact: { first_name: 'Anna' } };
    const filters: FilterGroup = {
      logic: 'and',
      conditions: [{ property: 'contact.first_name', operator: 'equals', value: 'Anna' }],
    };
    assert.equal(evaluateFilters(filters, record), true);
  });
});
