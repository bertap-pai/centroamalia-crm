import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTags } from '../services/workflow-merge-tags.js';
import { extractClassification } from '../services/step-executors/ai-classify.js';

describe('MergeContext var namespace', () => {
  it('resolves {{var.key}} when var is populated', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { welcome_message: 'Hola Ana, benvinguda!' },
    };
    const result = resolveMergeTags('Message: {{var.welcome_message}}', ctx);
    assert.equal(result, 'Message: Hola Ana, benvinguda!');
  });

  it('returns empty string for missing var key', () => {
    const ctx = { var: { other_key: 'x' } };
    const result = resolveMergeTags('{{var.missing}}', ctx);
    assert.equal(result, '');
  });

  it('returns empty string when var namespace is absent', () => {
    const ctx = { contact: { first_name: 'Ana' } };
    const result = resolveMergeTags('{{var.anything}}', ctx);
    assert.equal(result, '');
  });

  it('combines var tags with contact tags in same template', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { promo_code: 'WELCOME10' },
    };
    const result = resolveMergeTags('Hola {{contact.first_name}}, el teu codi és {{var.promo_code}}', ctx);
    assert.equal(result, 'Hola Ana, el teu codi és WELCOME10');
  });
});

describe('extractClassification', () => {
  it('returns exact match when response equals a category', () => {
    const result = extractClassification('hot_lead', ['hot_lead', 'cold_lead', 'nurture']);
    assert.equal(result, 'hot_lead');
  });

  it('is case-insensitive for exact match', () => {
    const result = extractClassification('Hot_Lead', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'hot_lead');
  });

  it('falls back to partial match when response includes category', () => {
    const result = extractClassification('I classify this as cold_lead.', ['hot_lead', 'cold_lead']);
    assert.equal(result, 'cold_lead');
  });

  it('returns null when no category matches', () => {
    const result = extractClassification('unknown', ['hot_lead', 'cold_lead']);
    assert.equal(result, null);
  });
});

describe('trigger_agent merge tag resolution', () => {
  it('resolves contact merge tags in title', () => {
    const ctx = { contact: { first_name: 'Ana', last_name: 'García' } };
    const template = 'Onboarding task for {{contact.first_name}} {{contact.last_name}}';
    const resolved = resolveMergeTags(template, ctx);
    assert.equal(resolved, 'Onboarding task for Ana García');
  });

  it('resolves var namespace in message', () => {
    const ctx = {
      contact: { first_name: 'Ana' },
      var: { ai_summary: 'Interested in premium plan' },
    };
    const template = '{{contact.first_name}} context: {{var.ai_summary}}';
    const resolved = resolveMergeTags(template, ctx);
    assert.equal(resolved, 'Ana context: Interested in premium plan');
  });
});
