import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import WorkflowFilterBuilder, { type FilterGroup } from '../components/WorkflowFilterBuilder.js';
import WorkflowStepEditor from '../components/WorkflowStepEditor.js';

type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived' | 'error';

interface WorkflowStep {
  id: string;
  order: number;
  type: string;
  config: Record<string, unknown>;
  parentStepId: string | null;
  branch: string | null;
}

interface WorkflowDetail {
  id: string;
  name: string;
  status: WorkflowStatus;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  enrollmentMode: string;
  filters: FilterGroup | null;
  steps: WorkflowStep[];
}

const TRIGGER_OPTIONS = [
  { value: 'form_submitted', label: 'Formulari enviat' },
  { value: 'contact_created', label: 'Contacte creat' },
  { value: 'contact_updated', label: 'Contacte actualitzat' },
  { value: 'contact_deleted', label: 'Contacte eliminat' },
  { value: 'deal_created', label: 'Deal creat' },
  { value: 'deal_stage_changed', label: 'Canvi d\'etapa de deal' },
  { value: 'task_completed', label: 'Tasca completada' },
  { value: 'meeting_scheduled', label: 'Sessió programada' },
  { value: 'property_changed', label: 'Propietat de contacte canviada' },
];

const ENROLLMENT_OPTIONS = [
  { value: 'once', label: 'Una vegada (lifetime)' },
  { value: 'once_per_week', label: 'Una vegada per setmana' },
  { value: 'every_time', label: 'Cada vegada' },
];

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  draft: '#999',
  active: '#2e7d32',
  paused: '#e65100',
  archived: '#bbb',
  error: '#c62828',
};

type Tab = 'config' | 'executions';

export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('config');

  // Editable fields
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('form_submitted');
  const [enrollmentMode, setEnrollmentMode] = useState('once');
  const [filters, setFilters] = useState<FilterGroup | null>(null);

  function loadWorkflow() {
    if (!id) return;
    setLoading(true);
    api.get(`/api/workflows/${id}`)
      .then((data: WorkflowDetail) => {
        setWf(data);
        setName(data.name);
        setTriggerType(data.triggerType);
        setEnrollmentMode(data.enrollmentMode);
        setFilters(data.filters);
        setError('');
      })
      .catch(() => setError('Error carregant el workflow.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadWorkflow(); }, [id]);

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      await api.put(`/api/workflows/${id}`, { name, triggerType, enrollmentMode, filters });
      await loadWorkflow();
    } catch {
      setError('Error desant el workflow.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!id) return;
    try {
      await api.post(`/api/workflows/${id}/publish`);
      await loadWorkflow();
    } catch (e: any) {
      setError(e.message ?? 'Error publicant el workflow.');
    }
  }

  async function handlePause() {
    if (!id) return;
    try {
      await api.post(`/api/workflows/${id}/pause`);
      await loadWorkflow();
    } catch {
      setError('Error pausant el workflow.');
    }
  }

  async function handleDelete() {
    if (!id || !confirm('Eliminar aquest workflow?')) return;
    try {
      await api.delete(`/api/workflows/${id}`);
      navigate('/workflows');
    } catch {
      setError('Error eliminant el workflow.');
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Carregant...</div>;
  if (!wf) return <div style={{ padding: 24, color: '#c62828' }}>{error || 'Workflow no trobat.'}</div>;

  const canEdit = wf.status === 'draft' || wf.status === 'paused';

  return (
    <div style={{ padding: '24px', maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={() => navigate('/workflows')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: 20 }}>←</button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          style={{ fontSize: 20, fontWeight: 600, border: 'none', borderBottom: canEdit ? '1px solid #ccc' : 'none', outline: 'none', flex: 1, padding: '2px 4px' }}
        />
        <span style={{ color: STATUS_COLOR[wf.status], fontWeight: 500, fontSize: 13, padding: '2px 10px', border: `1px solid ${STATUS_COLOR[wf.status]}`, borderRadius: 12 }}>
          {wf.status}
        </span>
        {canEdit && (
          <button onClick={handleSave} disabled={saving} style={{ padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {saving ? 'Desant...' : 'Desar'}
          </button>
        )}
        {wf.status === 'draft' && (
          <button onClick={handlePublish} style={{ padding: '6px 16px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Publicar
          </button>
        )}
        {wf.status === 'active' && (
          <button onClick={handlePause} style={{ padding: '6px 16px', background: '#e65100', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Pausar
          </button>
        )}
        <button onClick={handleDelete} style={{ padding: '6px 12px', background: 'none', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', color: '#c62828' }}>
          Eliminar
        </button>
      </div>

      {error && <div style={{ color: '#c62828', marginBottom: 16 }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e0e0e0', marginBottom: 24 }}>
        {(['config', 'executions'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #1a73e8' : '2px solid transparent',
              color: tab === t ? '#1a73e8' : '#555', fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === 'config' ? 'Configuració' : 'Execucions'}
          </button>
        ))}
      </div>

      {tab === 'config' && (
        <div>
          {/* Trigger config */}
          <section style={{ marginBottom: 28 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Trigger</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Tipus</label>
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value)}
                  disabled={!canEdit}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
                >
                  {TRIGGER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Mode d'inscripció</label>
                <select
                  value={enrollmentMode}
                  onChange={(e) => setEnrollmentMode(e.target.value)}
                  disabled={!canEdit}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
                >
                  {ENROLLMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Filter config */}
          <section style={{ marginBottom: 28 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Filtres (qui entra al workflow)</h3>
            {canEdit ? (
              <WorkflowFilterBuilder value={filters} onChange={setFilters} />
            ) : (
              <div style={{ color: '#888', fontSize: 13 }}>
                {filters ? `${(filters.conditions ?? []).length} condició(ns) — ${filters.logic.toUpperCase()}` : 'Cap filtre (tots els contactes)'}
              </div>
            )}
          </section>

          {/* Step list */}
          <section>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Passos</h3>
            <WorkflowStepEditor
              workflowId={wf.id}
              steps={wf.steps}
              canEdit={canEdit}
              onReload={loadWorkflow}
            />
          </section>
        </div>
      )}

      {tab === 'executions' && (
        <ExecutionsTab workflowId={wf.id} />
      )}
    </div>
  );
}

function ExecutionsTab({ workflowId }: { workflowId: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/workflows/${workflowId}/runs`)
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) return <div>Carregant execucions...</div>;
  if (runs.length === 0) return <div style={{ color: '#888', padding: '24px 0' }}>Cap execució registrada.</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
          <th style={{ padding: '8px 10px' }}>Contacte</th>
          <th style={{ padding: '8px 10px' }}>Estat</th>
          <th style={{ padding: '8px 10px' }}>Inici</th>
          <th style={{ padding: '8px 10px' }}>Fi</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '8px 10px' }}>{r.contactId}</td>
            <td style={{ padding: '8px 10px' }}>{r.status}</td>
            <td style={{ padding: '8px 10px' }}>{new Date(r.startedAt).toLocaleString('ca-ES')}</td>
            <td style={{ padding: '8px 10px' }}>{r.completedAt ? new Date(r.completedAt).toLocaleString('ca-ES') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
