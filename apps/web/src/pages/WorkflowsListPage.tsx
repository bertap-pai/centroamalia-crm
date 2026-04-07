import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

interface WorkflowItem {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived' | 'error';
  triggerType: string;
  enrollmentMode: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: '#999',
  active: '#2e7d32',
  paused: '#e65100',
  archived: '#bbb',
  error: '#c62828',
};

const TRIGGER_LABEL: Record<string, string> = {
  contact_created: 'Contacte creat',
  contact_updated: 'Contacte actualitzat',
  contact_deleted: 'Contacte eliminat',
  deal_created: 'Deal creat',
  deal_stage_changed: 'Canvi d\'etapa',
  form_submitted: 'Formulari enviat',
  task_completed: 'Tasca completada',
  meeting_scheduled: 'Sessió programada',
  property_changed: 'Propietat canviada',
};

export default function WorkflowsListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    setLoading(true);
    api.get('/api/workflows')
      .then((data) => { setItems(data); setError(''); })
      .catch(() => setError('Error carregant els workflows.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const wf = await api.post('/api/workflows', {
        name: newName.trim(),
        triggerType: 'form_submitted',
        enrollmentMode: 'once',
      });
      navigate(`/workflows/${wf.id}`);
    } catch {
      setError('Error creant el workflow.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Workflows</h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '8px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          + Nou workflow
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom del workflow"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button type="submit" disabled={creating} style={{ padding: '8px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {creating ? 'Creant...' : 'Crear'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', background: '#fff' }}>
            Cancel·lar
          </button>
        </form>
      )}

      {error && <div style={{ color: '#c62828', marginBottom: 16 }}>{error}</div>}
      {loading ? (
        <div>Carregant...</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#666', padding: '40px 0', textAlign: 'center' }}>Cap workflow. Crea'n un per començar.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>Nom</th>
              <th style={{ padding: '8px 12px' }}>Trigger</th>
              <th style={{ padding: '8px 12px' }}>Estat</th>
              <th style={{ padding: '8px 12px' }}>Creat</th>
            </tr>
          </thead>
          <tbody>
            {items.map((wf) => (
              <tr
                key={wf.id}
                onClick={() => navigate(`/workflows/${wf.id}`)}
                style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{wf.name}</td>
                <td style={{ padding: '10px 12px', color: '#555', fontSize: 13 }}>
                  {TRIGGER_LABEL[wf.triggerType] ?? wf.triggerType}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ color: STATUS_COLOR[wf.status] ?? '#666', fontWeight: 500, fontSize: 13 }}>
                    {wf.status}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>
                  {new Date(wf.createdAt).toLocaleDateString('ca-ES')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
