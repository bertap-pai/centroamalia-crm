import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface FormItem {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  createdAt: string;
  submissionCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Esborrany',
  active: 'Actiu',
  paused: 'Pausat',
  archived: 'Arxivat',
};

const STATUS_COLOR: Record<string, string> = {
  draft: '#999',
  active: '#2e7d32',
  paused: '#e65100',
  archived: '#bbb',
};

export default function FormsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<FormItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/api/forms')
      .then((data) => { setItems(data); setError(''); })
      .catch(() => setError('Error carregant els formularis.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const form = await api.post('/api/forms', { name: newName.trim() });
      navigate(`/forms/${form.id}/edit`);
    } catch {
      setError('Error creant el formulari.');
      setCreating(false);
    }
  }

  if (loading) return <div style={{ padding: 32, color: '#999' }}>Carregant...</div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Formularis</h1>
        {user?.role === 'admin' && (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Nou formulari
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c0392b', fontSize: 13 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 600 }}>×</button>
        </div>
      )}

      {showCreate && (
        <div style={{ background: '#f9f9f9', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom del formulari"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14 }}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1 }}
            >
              {creating ? 'Creant...' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(''); }}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: '#666' }}
            >
              Cancel·lar
            </button>
          </form>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
              <th style={th}>Nom</th>
              <th style={th}>Estat</th>
              <th style={th}>Submissions</th>
              <th style={th}>Creat</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr
                key={f.id}
                style={{ borderBottom: '1px solid #f3f3f3', cursor: 'pointer' }}
                onClick={() => navigate(`/forms/${f.id}/edit`)}
              >
                <td style={td}>
                  <div style={{ fontWeight: 500 }}>{f.name}</div>
                  {f.description && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{f.description}</div>}
                </td>
                <td style={td}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    background: STATUS_COLOR[f.status] + '22',
                    color: STATUS_COLOR[f.status],
                  }}>
                    {STATUS_LABEL[f.status]}
                  </span>
                </td>
                <td style={{ ...td, color: '#666' }}>{f.submissionCount}</td>
                <td style={{ ...td, color: '#999', fontSize: 12 }}>
                  {new Date(f.createdAt).toLocaleDateString('ca-ES')}
                </td>
                <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => navigate(`/forms/${f.id}/submissions`)}
                      style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#555' }}
                    >
                      Respostes
                    </button>
                    {user?.role === 'admin' && (
                      <button
                        disabled={cloningId === f.id}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setCloningId(f.id);
                          try {
                            const cloned = await api.post(`/api/forms/${f.id}/clone`, {});
                            navigate(`/forms/${cloned.id}/edit`);
                          } catch {
                            setError('Error duplicant el formulari.');
                            setCloningId(null);
                          }
                        }}
                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: cloningId === f.id ? 'not-allowed' : 'pointer', color: '#555', opacity: cloningId === f.id ? 0.5 : 1 }}
                      >
                        {cloningId === f.id ? 'Duplicant...' : 'Duplicar'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '32px 16px', color: '#bbb', textAlign: 'center' }}>
                  Encara no hi ha formularis. Crea'n un!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const td: React.CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'middle',
};
