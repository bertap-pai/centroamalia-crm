import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTags } from '../services/workflow-merge-tags.js';

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
