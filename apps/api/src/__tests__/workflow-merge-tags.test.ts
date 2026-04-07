import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTags, type MergeContext } from '../services/workflow-merge-tags.js';

describe('resolveMergeTags', () => {
  const context: MergeContext = {
    contact: {
      first_name: 'Anna',
      last_name: 'Garcia',
      email: 'anna@example.com',
      phone: '+34612345678',
    },
    deal: {
      id: 'deal-123',
      stage_name: 'Qualification',
      pipeline_id: 'pipe-1',
    },
    trigger: {
      form_name: 'Contact Form',
      completed_at: '2026-04-07T10:30:00Z',
    },
    workflow: {
      id: 'wf-1',
      name: 'Welcome Flow',
    },
  };

  // ── Basic resolution ────────────────────────────────────────────────

  it('resolves simple contact tags', () => {
    const result = resolveMergeTags('Hello {{contact.first_name}}!', context);
    assert.equal(result, 'Hello Anna!');
  });

  it('resolves multiple tags in one string', () => {
    const result = resolveMergeTags(
      '{{contact.first_name}} {{contact.last_name}} ({{contact.email}})',
      context,
    );
    assert.equal(result, 'Anna Garcia (anna@example.com)');
  });

  it('resolves deal tags', () => {
    const result = resolveMergeTags('Deal stage: {{deal.stage_name}}', context);
    assert.equal(result, 'Deal stage: Qualification');
  });

  it('resolves trigger tags', () => {
    const result = resolveMergeTags('Form: {{trigger.form_name}}', context);
    assert.equal(result, 'Form: Contact Form');
  });

  it('resolves workflow tags', () => {
    const result = resolveMergeTags('Workflow: {{workflow.name}}', context);
    assert.equal(result, 'Workflow: Welcome Flow');
  });

  // ── Missing values ──────────────────────────────────────────────────

  it('returns empty string for unknown namespace', () => {
    const result = resolveMergeTags('{{unknown.field}}', context);
    assert.equal(result, '');
  });

  it('returns empty string for unknown property', () => {
    const result = resolveMergeTags('{{contact.nonexistent}}', context);
    assert.equal(result, '');
  });

  it('returns empty string when context namespace is missing', () => {
    const result = resolveMergeTags('{{centre.name}}', context);
    assert.equal(result, '');
  });

  // ── No tags ─────────────────────────────────────────────────────────

  it('returns original string when no tags present', () => {
    const result = resolveMergeTags('No tags here', context);
    assert.equal(result, 'No tags here');
  });

  it('handles empty string', () => {
    const result = resolveMergeTags('', context);
    assert.equal(result, '');
  });

  // ── Pipe filters ────────────────────────────────────────────────────

  it('capitalize filter', () => {
    const ctx: MergeContext = { contact: { first_name: 'anna' } };
    const result = resolveMergeTags('{{contact.first_name | capitalize}}', ctx);
    assert.equal(result, 'Anna');
  });

  it('uppercase filter', () => {
    const result = resolveMergeTags('{{contact.first_name | uppercase}}', context);
    assert.equal(result, 'ANNA');
  });

  it('lowercase filter', () => {
    const result = resolveMergeTags('{{contact.first_name | lowercase}}', context);
    assert.equal(result, 'anna');
  });

  it('default filter with value present', () => {
    const result = resolveMergeTags('{{contact.first_name | default:Friend}}', context);
    assert.equal(result, 'Anna');
  });

  it('default filter with missing value', () => {
    const result = resolveMergeTags('{{contact.nickname | default:Friend}}', context);
    assert.equal(result, 'Friend');
  });

  it('date filter', () => {
    const result = resolveMergeTags('{{trigger.completed_at | date:dd/MM/yyyy}}', context);
    assert.equal(result, '07/04/2026');
  });

  it('date filter with default format', () => {
    const result = resolveMergeTags('{{trigger.completed_at | date}}', context);
    assert.equal(result, '2026-04-07');
  });

  // ── Chained filters ─────────────────────────────────────────────────

  it('supports chained filters', () => {
    const ctx: MergeContext = { contact: { first_name: 'anna' } };
    const result = resolveMergeTags('{{contact.first_name | capitalize | uppercase}}', ctx);
    // capitalize first, then uppercase
    assert.equal(result, 'ANNA');
  });
});
