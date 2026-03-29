import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stage {
  id: string;
  name: string;
  slug: string;
  position: number;
  isClosedWon: boolean;
  isClosedLost: boolean;
  requiredFields: string[];
}

interface Pipeline {
  id: string;
  name: string;
  slug: string;
}

interface DealContact {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  isPrimary: boolean;
  role: string | null;
  archivedAt: string | null;
}

interface StageHistoryEntry {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  fromStageName: string | null;
  toStageName: string | null;
  changedAt: string;
  changedByName: string | null;
  source: string;
}

interface DealDetail {
  id: string;
  pipelineId: string;
  stageId: string;
  ownerUserId: string | null;
  ownerName: string | null;
  isClosedWon: boolean;
  isClosedLost: boolean;
  currentStageEnteredAt: string;
  createdAt: string;
  archivedAt: string | null;
  pipeline: Pipeline | null;
  stages: Stage[];
  currentStage: Stage | null;
  properties: Record<string, string>;
  contacts: DealContact[];
  stageHistory: StageHistoryEntry[];
}

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  scope: string;
  options: Array<{ key: string; label: string }> | null;
  isSensitive: boolean;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [usersList, setUsersList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editOwner, setEditOwner] = useState('');
  const [editProps, setEditProps] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Stage move
  const [movingToStageId, setMovingToStageId] = useState<string | null>(null);
  const [stageValidationError, setStageValidationError] = useState<string[] | null>(null);

  // Contact search (add contact)
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<any[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/deals/${id}`),
      api.get('/api/properties?scope=deal'),
      api.get('/api/users'),
    ])
      .then(([d, defs, us]) => {
        setDeal(d);
        setPropDefs(defs);
        setUsersList(us);
        setLoading(false);
      })
      .catch((err: any) => {
        if (err.status === 404) navigate('/deals', { replace: true });
        else setError(err.message ?? 'Error en carregar el deal.');
        setLoading(false);
      });
  }, [id]);

  // Contact search debounce
  useEffect(() => {
    if (!contactSearch.trim() || contactSearch.length < 2) { setContactResults([]); return; }
    const t = setTimeout(async () => {
      setSearchingContacts(true);
      try {
        const res = await api.get(`/api/contacts?q=${encodeURIComponent(contactSearch)}&pageSize=8`);
        setContactResults(res.data ?? []);
      } catch { setContactResults([]); }
      finally { setSearchingContacts(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [contactSearch]);

  async function handleArchive() {
    if (!deal || archiving) return;
    setArchiving(true);
    try {
      const updated = await api.post(deal.archivedAt ? `/api/deals/${id}/restore` : `/api/deals/${id}/archive`);
      setDeal({ ...deal, archivedAt: updated.archivedAt });
    } finally { setArchiving(false); }
  }

  function startEdit() {
    if (!deal) return;
    setEditOwner(deal.ownerUserId ?? '');
    setEditProps({ ...deal.properties });
    setEditing(true);
  }

  async function saveEdit() {
    if (!deal) return;
    setSaving(true);
    try {
      const updated = await api.patch(`/api/deals/${id}`, {
        ownerUserId: editOwner || null,
        properties: editProps,
      });
      setDeal({ ...deal, ...updated, properties: { ...deal.properties, ...editProps } });
      setEditing(false);
    } catch { alert('Error en guardar. Torna-ho a intentar.'); }
    finally { setSaving(false); }
  }

  async function handleMoveStage(stageId: string) {
    if (!deal || stageId === deal.stageId) return;
    setMovingToStageId(stageId);
    setStageValidationError(null);
    try {
      const updated = await api.post(`/api/deals/${id}/stage`, { stageId });
      // Reload full deal to get updated history + stage
      const refreshed = await api.get(`/api/deals/${id}`);
      setDeal(refreshed);
    } catch (err: any) {
      if (err.data?.error === 'validation_failed') {
        setStageValidationError(err.data.missingFields);
      } else {
        alert('Error en moure el deal. Torna-ho a intentar.');
      }
    } finally { setMovingToStageId(null); }
  }

  async function handleAddContact(contactId: string) {
    if (!deal) return;
    try {
      await api.post(`/api/deals/${id}/contacts`, { contactId });
      const refreshed = await api.get(`/api/deals/${id}`);
      setDeal(refreshed);
      setShowAddContact(false);
      setContactSearch('');
      setContactResults([]);
    } catch (err: any) {
      alert(err.data?.error ?? 'Error en afegir el contacte.');
    }
  }

  async function handleRemoveContact(contactId: string) {
    if (!deal) return;
    if (!confirm('Eliminar aquest contacte del deal?')) return;
    try {
      await api.delete(`/api/deals/${id}/contacts/${contactId}`);
      const refreshed = await api.get(`/api/deals/${id}`);
      setDeal(refreshed);
    } catch (err: any) {
      alert(err.data?.error === 'cannot_remove_primary_contact'
        ? 'No es pot eliminar el contacte principal.'
        : 'Error en eliminar el contacte.');
    }
  }

  const defFor = (key: string) => propDefs.find((d) => d.key === key);

  const displayVal = (key: string, val: string) => {
    const def = defFor(key);
    if (!def || !val) return val || '—';
    if ((def.type === 'select' || def.type === 'multiselect') && def.options) {
      return def.options.find((o) => o.key === val)?.label ?? val;
    }
    if (def.type === 'datetime' || def.type === 'date') {
      try {
        return new Intl.DateTimeFormat('ca-ES', {
          day: '2-digit', month: 'short', year: 'numeric',
          ...(def.type === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {}),
        }).format(new Date(val));
      } catch { return val; }
    }
    return val;
  };

  const fmtDateTime = (s: string | null) => {
    if (!s) return '—';
    return new Intl.DateTimeFormat('ca-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(s));
  };

  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    return new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s));
  };

  if (loading) return <div style={{ padding: 48, color: '#999' }}>Carregant...</div>;
  if (error) return <div style={{ padding: 48, color: 'var(--color-error)' }}>{error}</div>;
  if (!deal) return null;

  const primaryContact = deal.contacts.find((c) => c.isPrimary);
  const additionalContacts = deal.contacts.filter((c) => !c.isPrimary);
  const contactName = (c: DealContact) =>
    [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phoneE164 || c.email || 'Sense nom';
  const title = primaryContact ? contactName(primaryContact) : 'Deal sense contacte';

  const dealPropDefs = propDefs.filter((d) => d.scope === 'deal' || d.scope === 'both');

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
        <Link to="/deals" style={{ color: '#999', textDecoration: 'none' }}>Deals</Link> / {title}
      </div>

      {/* Header */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '24px', border: '1px solid var(--color-border)', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div
            style={{
              width: 48, height: 48, borderRadius: 8,
              background: deal.isClosedWon ? '#27ae60' : deal.isClosedLost ? '#e74c3c' : 'var(--color-primary)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}
          >
            💼
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>
              {deal.archivedAt && <Tag color="#888" bg="#eee">Arxivat</Tag>}
              {deal.isClosedWon && <Tag color="#fff" bg="#27ae60">Won</Tag>}
              {deal.isClosedLost && <Tag color="#fff" bg="#e74c3c">Lost</Tag>}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span><span style={{ color: '#999' }}>Pipeline: </span>{deal.pipeline?.name ?? '—'}</span>
              <span><span style={{ color: '#999' }}>Etapa: </span>{deal.currentStage?.name ?? '—'}</span>
              <span><span style={{ color: '#999' }}>Responsable: </span>{deal.ownerName ?? '—'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>Creat el {fmtDate(deal.createdAt)}</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {!editing ? (
              <>
                <button onClick={startEdit} style={outlineBtn}>Editar</button>
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  style={{ ...outlineBtn, color: deal.archivedAt ? '#27ae60' : '#e74c3c', borderColor: deal.archivedAt ? '#27ae60' : '#e74c3c' }}
                >
                  {archiving ? '...' : deal.archivedAt ? 'Restaurar' : 'Arxivar'}
                </button>
              </>
            ) : (
              <>
                <button onClick={saveEdit} disabled={saving} style={primaryBtn}>{saving ? 'Guardant...' : 'Guardar'}</button>
                <button onClick={() => setEditing(false)} style={outlineBtn}>Cancel·lar</button>
              </>
            )}
          </div>
        </div>

        {/* Edit form */}
        {editing && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Label>Responsable</Label>
              <select
                value={editOwner}
                onChange={(e) => setEditOwner(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              >
                <option value="">— Sense responsable —</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Stage pipeline bar */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '16px 24px', border: '1px solid var(--color-border)', marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Etapa
        </h3>
        {stageValidationError && (
          <div style={{ background: '#fff3cd', border: '1px solid #f0b99e', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#856404' }}>
            ⚠ Cal omplir: <strong>{stageValidationError.join(', ')}</strong>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {deal.stages.map((stage) => {
            const isCurrent = stage.id === deal.stageId;
            const isMoving = movingToStageId === stage.id;
            return (
              <button
                key={stage.id}
                onClick={() => handleMoveStage(stage.id)}
                disabled={isCurrent || isMoving !== false}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: isCurrent ? 'default' : 'pointer',
                  border: isCurrent ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: isCurrent ? 'var(--color-primary)' : isMoving ? '#e0e0e0' : '#f9f9f9',
                  color: isCurrent ? '#fff' : '#555',
                  fontWeight: isCurrent ? 700 : 400,
                  opacity: stage.isClosedLost ? 0.6 : 1,
                }}
              >
                {stage.name}
                {isMoving && ' ...'}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Contacts */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Contactes
            </h3>
            <button
              onClick={() => setShowAddContact((v) => !v)}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: '#666' }}
            >
              + Afegir
            </button>
          </div>

          {showAddContact && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Cerca contacte..."
                style={{ ...inputStyle, width: '100%' }}
                autoFocus
              />
              {(contactResults.length > 0 || searchingContacts) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
                  border: '1px solid var(--color-border)', borderRadius: 6, zIndex: 10,
                  boxShadow: 'var(--shadow-sm)', maxHeight: 180, overflowY: 'auto',
                }}>
                  {searchingContacts ? (
                    <div style={{ padding: '8px 12px', color: '#999', fontSize: 13 }}>Cercant...</div>
                  ) : contactResults.map((c: any) => {
                    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phoneE164 || 'Sense nom';
                    const alreadyLinked = deal.contacts.some((dc) => dc.contactId === c.id);
                    return (
                      <div
                        key={c.id}
                        onClick={() => !alreadyLinked && handleAddContact(c.id)}
                        style={{
                          padding: '8px 12px', cursor: alreadyLinked ? 'default' : 'pointer', fontSize: 13,
                          borderBottom: '1px solid var(--color-border)',
                          background: alreadyLinked ? '#f9f9f9' : undefined,
                          color: alreadyLinked ? '#bbb' : undefined,
                        }}
                        onMouseEnter={(e) => { if (!alreadyLinked) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = alreadyLinked ? '#f9f9f9' : ''; }}
                      >
                        <strong>{name}</strong>
                        {c.phoneE164 && <span style={{ color: '#999', marginLeft: 8 }}>{c.phoneE164}</span>}
                        {alreadyLinked && <span style={{ marginLeft: 6, fontSize: 11 }}>ja vinculat</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deal.contacts.map((c) => (
              <div
                key={c.contactId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: '1px solid var(--color-border)', borderRadius: 6,
                  opacity: c.archivedAt ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: '50%', background: c.isPrimary ? 'var(--color-primary)' : '#ddd',
                    color: c.isPrimary ? '#fff' : '#666', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {(c.firstName?.[0] ?? c.phoneE164?.[3] ?? '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Link to={`/contacts/${c.contactId}`} style={{ color: 'var(--color-text)', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                      {contactName(c)}
                    </Link>
                    {c.isPrimary && <Tag color="#fff" bg="var(--color-primary)" size={10}>Principal</Tag>}
                    {c.role && <Tag color="#555" bg="#eee" size={10}>{c.role}</Tag>}
                  </div>
                  {c.phoneE164 && <div style={{ fontSize: 11, color: '#888' }}>{c.phoneE164}</div>}
                </div>
                {!c.isPrimary && (
                  <button
                    onClick={() => handleRemoveContact(c.contactId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 16, padding: '0 4px' }}
                    title="Eliminar"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {deal.contacts.length === 0 && (
              <div style={{ color: '#999', fontSize: 13 }}>Cap contacte vinculat.</div>
            )}
          </div>
        </div>

        {/* Stage History */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Historial d'etapes
          </h3>
          {deal.stageHistory.length === 0 ? (
            <div style={{ color: '#999', fontSize: 13 }}>Sense historial.</div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 1, background: 'var(--color-border)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {deal.stageHistory.map((h, idx) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div
                      style={{
                        width: 22, height: 22, borderRadius: '50%', background: idx === deal.stageHistory.length - 1 ? 'var(--color-primary)' : '#fff',
                        border: `2px solid ${idx === deal.stageHistory.length - 1 ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        flexShrink: 0, zIndex: 1,
                      }}
                    />
                    <div style={{ paddingTop: 2, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>
                        {h.fromStageName ? (
                          <><span style={{ color: '#999' }}>{h.fromStageName}</span> → <strong>{h.toStageName}</strong></>
                        ) : (
                          <><strong>Creat</strong> a <strong>{h.toStageName}</strong></>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                        {fmtDateTime(h.changedAt)}
                        {h.changedByName && <> · {h.changedByName}</>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic properties */}
      {dealPropDefs.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid var(--color-border)', marginTop: 16 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Propietats
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            {dealPropDefs.map((def) => {
              const val = deal.properties[def.key] ?? '';
              if (!val && !editing) return null;
              return (
                <div key={def.key}>
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {def.label}
                    {def.isSensitive && <span style={{ marginLeft: 4, color: '#e74c3c' }}>🔒</span>}
                  </div>
                  {editing ? (
                    def.type === 'select' && def.options ? (
                      <select
                        value={editProps[def.key] ?? ''}
                        onChange={(e) => setEditProps({ ...editProps, [def.key]: e.target.value })}
                        style={{ ...inputStyle, width: '100%' }}
                      >
                        <option value="">— Selecciona —</option>
                        {def.options.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={editProps[def.key] ?? ''}
                        onChange={(e) => setEditProps({ ...editProps, [def.key]: e.target.value })}
                        style={{ ...inputStyle, width: '100%' }}
                      />
                    )
                  ) : (
                    <div style={{ fontSize: 13 }}>{displayVal(def.key, val) || '—'}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Tag({ color, bg, size = 11, children }: { color: string; bg: string; size?: number; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: size, background: bg, color, borderRadius: 4,
        padding: '1px 5px', fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: '#999', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--color-border)',
  borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
