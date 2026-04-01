import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { NotesTasks } from '../components/NotesTasks.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactDetail {
  id: string;
  phoneE164: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: string;
  archivedAt: string | null;
  possibleIdentityMismatch: boolean;
  properties: Record<string, string>;
  deals: DealRow[];
}

interface DealRow {
  dealId: string;
  isPrimary: boolean;
  role: string | null;
  pipelineName: string;
  pipelineSlug: string;
  stageName: string;
  stageSlug: string;
  isClosedWon: boolean;
  isClosedLost: boolean;
  ownerName: string | null;
  createdAt: string;
  archivedAt: string | null;
}

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  scope: string;
  options: Array<{ key: string; label: string }> | null;
  isSensitive: boolean;
  group: string | null;
}

const CORE_KEYS = ['first_name', 'last_name', 'email', 'phone_e164', 'servei_interes'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/contacts/${id}`),
      api.get('/api/properties?scope=contact'),
    ])
      .then(([c, defs]) => {
        setContact(c);
        setPropDefs(defs);
        setLoading(false);
      })
      .catch((err: any) => {
        if (err.status === 404) navigate('/contacts', { replace: true });
        else setError(err.message ?? 'Error en carregar el contacte.');
        setLoading(false);
      });
  }, [id]);

  async function handleArchive() {
    if (!contact || archiving) return;
    setArchiving(true);
    try {
      const updated = await api.post(contact.archivedAt ? `/api/contacts/${id}/restore` : `/api/contacts/${id}/archive`);
      setContact({ ...contact, archivedAt: updated.archivedAt });
    } finally {
      setArchiving(false);
    }
  }

  function startEdit() {
    if (!contact) return;
    setEditForm({
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      email: contact.email ?? '',
      phone: contact.phoneE164 ?? '',
      ...contact.properties,
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!contact) return;
    const { firstName, lastName, email, phone, ...properties } = editForm;
    try {
      const updated = await api.patch(`/api/contacts/${id}`, {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        properties,
      });
      setContact({ ...contact, ...updated, properties: { ...contact.properties, ...properties } });
      setEditing(false);
    } catch (err: any) {
      if (err.status === 409) alert('Aquest telèfon ja existeix en un altre contacte.');
      else if (err.status === 400) alert('Telèfon no vàlid.');
      else alert('Error en guardar. Torna-ho a intentar.');
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

  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    return new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s));
  };

  if (loading) return <div style={{ padding: 48, color: '#999' }}>Carregant...</div>;
  if (error) return <div style={{ padding: 48, color: 'var(--color-error)' }}>{error}</div>;
  if (!contact) return null;

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Sense nom';

  // Build display groups from property definitions
  const displayGroups: { label: string; keys: string[] }[] = [];
  const groupOrder: string[] = [];
  const groupMap = new Map<string, string[]>();

  for (const def of propDefs) {
    if (!def.group || CORE_KEYS.includes(def.key)) continue;
    if (!groupMap.has(def.group)) {
      groupMap.set(def.group, []);
      groupOrder.push(def.group);
    }
    groupMap.get(def.group)!.push(def.key);
  }

  for (const label of groupOrder) {
    displayGroups.push({ label, keys: groupMap.get(label)! });
  }

  const allGroupKeys = displayGroups.flatMap((g) => g.keys);

  // Other properties not in any group or core
  // When editing, include all propDefs for this scope even if they have no value yet
  const otherKeysBase = Object.keys(contact.properties).filter(
    (k) => !CORE_KEYS.includes(k) && !allGroupKeys.includes(k),
  );
  const otherKeys = editing
    ? [
        ...new Set([
          ...otherKeysBase,
          ...propDefs
            .filter((d) => !CORE_KEYS.includes(d.key) && !allGroupKeys.includes(d.key))
            .map((d) => d.key),
        ]),
      ]
    : otherKeysBase;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 24px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
        <Link to="/contacts" style={{ color: '#999', textDecoration: 'none' }}>
          Contactes
        </Link>{' '}
        / {name}
      </div>

      {/* Header card */}
      <div
        style={{
          background: '#fff', borderRadius: 10, padding: '24px 24px 20px',
          border: '1px solid var(--color-border)', marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {/* Avatar */}
          <div
            style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'var(--color-primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700, flexShrink: 0,
            }}
          >
            {(contact.firstName?.[0] ?? contact.phoneE164?.[3] ?? '?').toUpperCase()}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{name}</h2>
              {contact.archivedAt && (
                <span style={{ fontSize: 11, background: '#eee', color: '#888', borderRadius: 4, padding: '2px 6px' }}>
                  Arxivat
                </span>
              )}
              {contact.possibleIdentityMismatch && (
                <span style={{ fontSize: 11, background: '#fff3cd', color: '#856404', borderRadius: 4, padding: '2px 6px' }}>
                  ⚠ Possible duplicat
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
              {contact.phoneE164 && <span style={{ marginRight: 16 }}>📞 {contact.phoneE164}</span>}
              {contact.email && <span>✉ {contact.email}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              Creat el {fmtDate(contact.createdAt)}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {!editing ? (
              <>
                <button onClick={startEdit} style={outlineBtn}>
                  Editar
                </button>
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  style={{ ...outlineBtn, color: contact.archivedAt ? '#27ae60' : '#e74c3c', borderColor: contact.archivedAt ? '#27ae60' : '#e74c3c' }}
                >
                  {archiving ? '...' : contact.archivedAt ? 'Restaurar' : 'Arxivar'}
                </button>
              </>
            ) : (
              <>
                <button onClick={saveEdit} style={primaryBtn}>Guardar</button>
                <button onClick={() => setEditing(false)} style={outlineBtn}>Cancel·lar</button>
              </>
            )}
          </div>
        </div>

        {/* Edit form — base fields */}
        {editing && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditField label="Nom" value={editForm['firstName'] ?? ''} onChange={(v) => setEditForm({ ...editForm, firstName: v })} />
            <EditField label="Cognoms" value={editForm['lastName'] ?? ''} onChange={(v) => setEditForm({ ...editForm, lastName: v })} />
            <EditField label="Telèfon" value={editForm['phone'] ?? ''} onChange={(v) => setEditForm({ ...editForm, phone: v })} />
            <EditField label="Email" value={editForm['email'] ?? ''} onChange={(v) => setEditForm({ ...editForm, email: v })} />
            <EditField label="Servei interès" value={editForm['servei_interes'] ?? ''} onChange={(v) => setEditForm({ ...editForm, servei_interes: v })} />
          </div>
        )}
      </div>

      {/* Properties card */}
      {displayGroups.map((group) => {
        const keys = group.keys.filter(
          (k) => contact.properties[k] !== undefined || (editing && defFor(k)),
        );
        if (keys.length === 0 && !editing) return null;
        return (
          <div
            key={group.label || '__ungrouped__'}
            style={{
              background: '#fff', borderRadius: 10, padding: '20px 24px',
              border: '1px solid var(--color-border)', marginBottom: 16,
            }}
          >
            {group.label && (
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#555' }}>
                {group.label}
              </h3>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              {group.keys.map((key) => {
                const def = defFor(key);
                if (!def) return null;
                const val = contact.properties[key] ?? '';
                if (!val && !editing) return null;
                return (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {def.label}
                      {def.isSensitive && <span style={{ marginLeft: 4, color: '#e74c3c' }}>🔒</span>}
                    </div>
                    {editing && (def.type === 'text' || def.type === 'textarea' || def.type === 'datetime' || def.type === 'date' || def.type === 'number') ? (
                      <EditField
                        label=""
                        value={editForm[key] ?? ''}
                        onChange={(v) => setEditForm({ ...editForm, [key]: v })}
                        multiline={def.type === 'textarea'}
                      />
                    ) : editing && (def.type === 'select') && def.options ? (
                      <select
                        value={editForm[key] ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                        style={{ ...inputStyle, width: '100%' }}
                      >
                        <option value="">— Selecciona —</option>
                        {def.options.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 13 }}>{displayVal(key, val) || '—'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Other properties */}
      {otherKeys.length > 0 && (
        <div
          style={{
            background: '#fff', borderRadius: 10, padding: '20px 24px',
            border: '1px solid var(--color-border)', marginBottom: 16,
          }}
        >
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#555' }}>Altres</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            {otherKeys.map((key) => {
              const def = defFor(key);
              const val = contact.properties[key] ?? '';
              if (!val && !editing) return null;
              return (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {def?.label ?? key}
                    {def?.isSensitive && <span style={{ marginLeft: 4, color: '#e74c3c' }}>🔒</span>}
                  </div>
                  {editing && def && (def.type === 'text' || def.type === 'textarea' || def.type === 'datetime' || def.type === 'date' || def.type === 'number') ? (
                    <EditField
                      label=""
                      value={editForm[key] ?? ''}
                      onChange={(v) => setEditForm({ ...editForm, [key]: v })}
                      multiline={def.type === 'textarea'}
                    />
                  ) : editing && def?.type === 'select' && def.options ? (
                    <select
                      value={editForm[key] ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                      style={{ ...inputStyle, width: '100%' }}
                    >
                      <option value="">— Selecciona —</option>
                      {def.options.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 13 }}>{displayVal(key, val) || '—'}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deals */}
      <div
        style={{
          background: '#fff', borderRadius: 10, padding: '20px 24px',
          border: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#555' }}>
            Deals ({contact.deals.length})
          </h3>
        </div>

        {contact.deals.length === 0 ? (
          <div style={{ color: '#999', fontSize: 13 }}>Cap deal associat.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contact.deals.map((d) => (
              <div
                key={d.dealId}
                style={{
                  padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 6,
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: d.archivedAt ? 0.5 : 1,
                }}
              >
                {d.isPrimary && (
                  <span style={{ fontSize: 10, background: 'var(--color-primary)', color: '#fff', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                    Principal
                  </span>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {d.pipelineName}
                    <span style={{ color: '#999', fontWeight: 400 }}> · {d.stageName}</span>
                  </div>
                  {d.ownerName && <div style={{ fontSize: 12, color: '#888' }}>{d.ownerName}</div>}
                </div>
                <div style={{ fontSize: 11, textAlign: 'right' }}>
                  {d.isClosedWon && <span style={{ color: '#27ae60', fontWeight: 600 }}>Won ✓</span>}
                  {d.isClosedLost && <span style={{ color: '#e74c3c', fontWeight: 600 }}>Lost</span>}
                  <div style={{ color: '#bbb', marginTop: 2 }}>{fmtDate(d.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes & Tasks */}
      <div style={{ marginTop: 20 }}>
        <NotesTasks objectType="contact" objectId={contact.id} />
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EditField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      {label && (
        <label style={{ display: 'block', fontSize: 11, color: '#999', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </label>
      )}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, width: '100%' }}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--color-border)',
  borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
