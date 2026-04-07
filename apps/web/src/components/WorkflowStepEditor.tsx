import { useState } from 'react';
import { api } from '../lib/api.js';

export interface WorkflowStep {
  id: string;
  order: number;
  type: string;
  config: Record<string, unknown>;
  parentStepId: string | null;
  branch: string | null;
}

const STEP_TYPE_OPTIONS = [
  { value: 'update_contact_property', label: 'Actualitzar propietat de contacte' },
  { value: 'create_task', label: 'Crear tasca' },
  { value: 'add_tag', label: 'Afegir etiqueta' },
  { value: 'remove_tag', label: 'Eliminar etiqueta' },
  { value: 'send_internal_notification', label: 'Notificació interna' },
  { value: 'webhook', label: 'Webhook extern' },
  { value: 'wait', label: 'Esperar (N hores/dies)' },
  { value: 'wait_until', label: 'Esperar fins que (condició)' },
  { value: 'branch', label: 'Branca IF/ELSE' },
  { value: 'create_deal', label: 'Crear deal' },
  { value: 'move_deal_stage', label: 'Moure deal d\'etapa' },
  { value: 'update_deal_property', label: 'Actualitzar propietat de deal' },
  { value: 'assign_owner', label: 'Assignar responsable' },
  { value: 'enroll_in_workflow', label: 'Inscriure en workflow' },
  { value: 'unenroll_from_workflow', label: 'Desinscriure de workflow' },
];

const STEP_ICONS: Record<string, string> = {
  update_contact_property: '✏️',
  create_task: '✅',
  add_tag: '🏷️',
  remove_tag: '🗑️',
  send_internal_notification: '🔔',
  webhook: '🌐',
  wait: '⏳',
  branch: '🔀',
  wait_until: '⏱️',
  create_deal: '💼',
  move_deal_stage: '➡️',
  update_deal_property: '📝',
  assign_owner: '👤',
  enroll_in_workflow: '↪️',
  unenroll_from_workflow: '↩️',
};

function configSummary(step: WorkflowStep): string {
  const c = step.config;
  switch (step.type) {
    case 'update_contact_property': return `${c.propertyName} = "${c.value}"`;
    case 'create_task': return `"${c.title}" | ${c.dueDays}d`;
    case 'add_tag': case 'remove_tag': return `tag: ${c.tag}`;
    case 'send_internal_notification': return `"${c.title}"`;
    case 'webhook': return `${c.method ?? 'POST'} ${c.url}`;
    case 'wait': return `${c.durationDays ?? c.durationHours ?? c.durationMinutes} ${c.durationDays ? 'dies' : c.durationHours ? 'hores' : 'min'}`;
    case 'wait_until': return `fins que condició (timeout: ${(c as any).timeoutDays}d)`;
    case 'branch': return 'IF / ELSE';
    case 'create_deal': return `Pipeline: ${c.pipelineId}`;
    case 'move_deal_stage': return `→ etapa ${c.targetStageId}`;
    case 'update_deal_property': return `${c.propertyKey} = "${c.value}"`;
    case 'assign_owner': return `mode: ${c.mode}`;
    case 'enroll_in_workflow': return `workflow: ${c.targetWorkflowId}`;
    case 'unenroll_from_workflow': return `workflow: ${c.targetWorkflowId}`;
    default: return JSON.stringify(c).slice(0, 60);
  }
}

function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'update_contact_property': return { propertyName: '', value: '' };
    case 'create_task': return { title: '', dueDays: 1, priority: 'medium' };
    case 'add_tag': case 'remove_tag': return { tag: '' };
    case 'send_internal_notification': return { title: '', body: '', priority: 'normal' };
    case 'webhook': return { url: '', method: 'POST' };
    case 'wait': return { durationDays: 1 };
    case 'wait_until': return { condition: null, timeoutDays: 7 };
    case 'branch': return { condition: null };
    case 'create_deal': return { pipelineId: '', stageId: '' };
    case 'move_deal_stage': return { targetStageId: '' };
    case 'update_deal_property': return { propertyKey: 'owner_user_id', value: '' };
    case 'assign_owner': return { target: 'deal', mode: 'fixed', userId: '' };
    case 'enroll_in_workflow': return { targetWorkflowId: '' };
    case 'unenroll_from_workflow': return { targetWorkflowId: '' };
    default: return {};
  }
}

interface Props {
  workflowId: string;
  steps: WorkflowStep[];
  canEdit: boolean;
  onReload: () => void;
}

export default function WorkflowStepEditor({ workflowId, steps, canEdit, onReload }: Props) {
  const topLevelSteps = steps.filter((s) => !s.parentStepId).sort((a, b) => a.order - b.order);
  const [addingStep, setAddingStep] = useState(false);
  const [newStepType, setNewStepType] = useState('send_internal_notification');
  const [newStepConfig, setNewStepConfig] = useState<Record<string, unknown>>(defaultConfig('send_internal_notification'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  async function handleAddStep() {
    setSaving(true);
    try {
      await api.post(`/api/workflows/${workflowId}/steps`, {
        type: newStepType,
        config: newStepConfig,
        order: topLevelSteps.length + 1,
      });
      setAddingStep(false);
      setNewStepType('send_internal_notification');
      setNewStepConfig(defaultConfig('send_internal_notification'));
      onReload();
    } catch {
      alert('Error afegint el pas.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStep(stepId: string) {
    setSaving(true);
    try {
      await api.patch(`/api/workflows/${workflowId}/steps/${stepId}`, { config: editConfig });
      setEditingId(null);
      onReload();
    } catch {
      alert('Error actualitzant el pas.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStep(stepId: string) {
    if (!confirm('Eliminar aquest pas?')) return;
    try {
      await api.delete(`/api/workflows/${workflowId}/steps/${stepId}`);
      onReload();
    } catch {
      alert('Error eliminant el pas.');
    }
  }

  return (
    <div>
      {topLevelSteps.length === 0 && (
        <div style={{ color: '#888', fontSize: 13, padding: '12px 0' }}>Cap pas. Afegeix el primer pas.</div>
      )}

      {topLevelSteps.map((step, idx) => (
        <div key={step.id} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 14, marginBottom: 10, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{STEP_ICONS[step.type] ?? '⚙️'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{idx + 1}. {STEP_TYPE_OPTIONS.find(o => o.value === step.type)?.label ?? step.type}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{configSummary(step)}</div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setEditingId(step.id); setEditConfig(step.config); }}
                  style={{ padding: '4px 10px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12, background: '#fff' }}
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDeleteStep(step.id)}
                  style={{ padding: '4px 10px', border: '1px solid #fcc', borderRadius: 4, cursor: 'pointer', fontSize: 12, background: '#fff', color: '#c62828' }}
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>

          {editingId === step.id && (
            <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
              <textarea
                value={JSON.stringify(editConfig, null, 2)}
                onChange={(e) => {
                  try { setEditConfig(JSON.parse(e.target.value)); } catch {}
                }}
                rows={6}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, border: '1px solid #ccc', borderRadius: 4, padding: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => handleUpdateStep(step.id)}
                  disabled={saving}
                  style={{ padding: '6px 14px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                >
                  Desar canvis
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  style={{ padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 13, background: '#fff' }}
                >
                  Cancel·lar
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {canEdit && !addingStep && (
        <button
          onClick={() => setAddingStep(true)}
          style={{ marginTop: 8, padding: '8px 16px', border: '1px dashed #aaa', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555', width: '100%' }}
        >
          + Afegir pas
        </button>
      )}

      {addingStep && (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 16, marginTop: 10, background: '#f9f9f9' }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Tipus de pas</label>
            <select
              value={newStepType}
              onChange={(e) => { setNewStepType(e.target.value); setNewStepConfig(defaultConfig(e.target.value)); }}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
            >
              {STEP_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Configuració (JSON)</label>
            <textarea
              value={JSON.stringify(newStepConfig, null, 2)}
              onChange={(e) => { try { setNewStepConfig(JSON.parse(e.target.value)); } catch {} }}
              rows={5}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, border: '1px solid #ccc', borderRadius: 4, padding: 8 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAddStep}
              disabled={saving}
              style={{ padding: '6px 14px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              {saving ? 'Afegint...' : 'Afegir pas'}
            </button>
            <button
              onClick={() => setAddingStep(false)}
              style={{ padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 13, background: '#fff' }}
            >
              Cancel·lar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
