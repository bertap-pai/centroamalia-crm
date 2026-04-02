import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

interface ListItem {
  id: string;
  name: string;
  description: string | null;
  objectType: 'contact' | 'deal';
  kind: 'static' | 'dynamic';
  criteria: Record<string, string> | null;
  isTeam: boolean;
  memberCount: number | null;
  createdByUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = { static: 'Estàtica', dynamic: 'Dinàmica' };
const KIND_COLOR: Record<string, string> = { static: '#2e7d32', dynamic: '#1565c0' };

export default function ListsIndexPage() {
  const navigate = useNavigate();
  const [objectType, setObjectType] = useState<'contact' | 'deal'>('contact');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [lists, setLists] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editList, setEditList] = useState<ListItem | null>(null);

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ objectType, ...(includeArchived ? { includeArchived: 'true' } : {}) });
    api.get(`/api/lists?${params}`)
      .then((data) => { setLists(data); setError(''); })
      .catch(() => setError('Error carregant les llistes.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [objectType, includeArchived]);

  async function handleArchive(list: ListItem) {
    if (!confirm(`Arxivar la llista "${list.name}"?`)) return;
    try {
      await api.delete(`/api/lists/${list.id}`);
      load();
    } catch {
      alert('Error arxivant la llista.');
    }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Llistes</h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
        >
          + Nova llista
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        {(['contact', 'deal'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setObjectType(t)}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: 'none', borderBottom: objectType === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: objectType === t ? 'var(--color-primary)' : '#666', marginBottom: -1,
            }}
          >
            {t === 'contact' ? 'Llistes de contactes' : 'Llistes de deals'}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Mostra arxivades
        </label>
      </div>

      {error && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ color: '#999', padding: '32px 0', textAlign: 'center' }}>Carregant...</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--color-border)' }}>
                {['Nom', 'Tipus', 'Membres', 'Accions'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '32px 16px', color: '#999', textAlign: 'center' }}>
                    Cap llista trobada.
                  </td>
                </tr>
              ) : (
                lists.map((list) => (
                  <tr
                    key={list.id}
                    style={{ borderBottom: '1px solid var(--color-border)', opacity: list.archivedAt ? 0.55 : 1 }}
                  >
                    <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                      <span
                        style={{ fontWeight: 500, cursor: 'pointer', color: 'var(--color-primary)' }}
                        onClick={() => navigate(`/lists/${list.id}`)}
                      >
                        {list.name}
                      </span>
                      {list.description && (
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{list.description}</div>
                      )}
                      {list.archivedAt && (
                        <span style={{ fontSize: 10, background: '#eee', color: '#888', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>Arxivada</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: KIND_COLOR[list.kind], background: list.kind === 'static' ? '#e8f5e9' : '#e3f2fd', borderRadius: 4, padding: '2px 7px' }}>
                        {KIND_LABEL[list.kind]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'middle', color: '#444' }}>
                      {list.memberCount !== null ? list.memberCount : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setEditList(list)}
                          style={{ fontSize: 12, color: '#555', background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
                        >
                          Editar
                        </button>
                        {!list.archivedAt && (
                          <button
                            onClick={() => handleArchive(list)}
                            style={{ fontSize: 12, color: '#c62828', background: 'none', border: '1px solid #ffcdd2', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
                          >
                            Arxivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <ListFormModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); load(); }}
        />
      )}

      {editList && (
        <ListFormModal
          list={editList}
          onClose={() => setEditList(null)}
          onSuccess={() => { setEditList(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Create / Edit modal ─────────────────────────────────────────────────────

function ListFormModal({
  list,
  onClose,
  onSuccess,
}: {
  list?: ListItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = Boolean(list);
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [objectType, setObjectType] = useState<'contact' | 'deal'>(list?.objectType ?? 'contact');
  const [kind, setKind] = useState<'static' | 'dynamic'>(list?.kind ?? 'static');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('El nom és obligatori.'); return; }
    setSaving(true);
    setError('');
    try {
      if (isEdit && list) {
        await api.patch(`/api/lists/${list.id}`, { name: name.trim(), description: description.trim() || null });
      } else {
        await api.post('/api/lists', { name: name.trim(), description: description.trim() || null, objectType, kind, isTeam: false });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Error en guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: '90%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>
          {isEdit ? 'Editar llista' : 'Nova llista'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>Nom *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, boxSizing: 'border-box' }}
              placeholder="Nom de la llista"
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>Descripció</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
              placeholder="Opcional"
            />
          </div>
          {!isEdit && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>Tipus d'objecte</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(['contact', 'deal'] as const).map((t) => (
                    <label key={t} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="objectType" value={t} checked={objectType === t} onChange={() => setObjectType(t)} />
                      {t === 'contact' ? 'Contactes' : 'Deals'}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>Tipus de llista</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(['static', 'dynamic'] as const).map((k) => (
                    <label key={k} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                      {KIND_LABEL[k]}
                    </label>
                  ))}
                </div>
                {kind === 'dynamic' && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#888', background: '#f5f5f5', borderRadius: 5, padding: '7px 10px' }}>
                    Les llistes dinàmiques es calculen automàticament a partir de criteris. Els criteris es configuren des del detall de la llista.
                  </div>
                )}
              </div>
            </>
          )}
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '7px 16px', border: '1px solid #ddd', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              Cancel·lar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: '7px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 5, cursor: saving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Guardant...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
