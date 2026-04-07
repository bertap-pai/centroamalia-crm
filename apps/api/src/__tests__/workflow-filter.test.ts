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

  // ── New operators (Phase 2) ─────────────────────────────────────────

  describe('new operators', () => {
    const record = {
      name: 'Anna Garcia',
      city: 'Barcelona',
      num_sessions: '8',
      status: 'Lead',
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    };

    it('contains: true when value is substring', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'name', operator: 'contains', value: 'Garcia' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('contains: false when not found', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'name', operator: 'contains', value: 'Smith' }] };
      assert.equal(evaluateFilters(f, record), false);
    });

    it('not_contains: true when absent', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'name', operator: 'not_contains', value: 'Smith' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('greater_than: true when number exceeds threshold', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'num_sessions', operator: 'greater_than', value: '5' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('greater_than: false when below threshold', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'num_sessions', operator: 'greater_than', value: '10' }] };
      assert.equal(evaluateFilters(f, record), false);
    });

    it('less_than: true when number is below threshold', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'num_sessions', operator: 'less_than', value: '10' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('starts_with: true when string begins with prefix', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'city', operator: 'starts_with', value: 'Bar' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('ends_with: true when string ends with suffix', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'city', operator: 'ends_with', value: 'ona' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('changed_in_last_n_days: true when date is within N days', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'created_at', operator: 'changed_in_last_n_days', value: '7' }] };
      assert.equal(evaluateFilters(f, record), true);
    });

    it('changed_in_last_n_days: false when date is older than N days', () => {
      const f: FilterGroup = { logic: 'and', conditions: [{ property: 'created_at', operator: 'changed_in_last_n_days', value: '2' }] };
      assert.equal(evaluateFilters(f, record), false);
    });
  });
});
