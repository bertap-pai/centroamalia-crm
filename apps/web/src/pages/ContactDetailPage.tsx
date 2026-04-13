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

const CORE_FIELD_MAP: Record<string, string> = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone_e164: 'phone',
};

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

  // Inline edit state (Option A)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState<string>('');

  // Layout config state (Options B + C)
  const [savedGroupOrder, setSavedGroupOrder] = useState<string[]>([]);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);

  // Drag state (Option B)
  const [dragGroupIdx, setDragGroupIdx] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/contacts/${id}`),
      api.get('/api/properties?scope=contact'),
      api.get('/api/contact-layout').catch(() => ({ groupOrder: [], pinnedPropertyKeys: [] })),
    ])
      .then(([c, defs, layout]) => {
        setContact(c);
        setPropDefs(defs);
        setSavedGroupOrder(layout.groupOrder ?? []);
        setPinnedKeys(layout.pinnedPropertyKeys ?? []);
        setLoading(false);
      })
      .catch((err: any) => {
        if (err.status === 404) navigate('/contacts', { replace: true });
        else setError(err.message ?? 'Error en carregar el contacte.');
        setLoading(false);
      });
  }, [id]);

  // ─── Inline edit helpers (Option A) ───────────────────────────────────────

  function getCoreValue(key: string): string {
    if (!contact) return '';
    switch (key) {
      case 'first_name': return contact.firstName ?? '';
      case 'last_name': return contact.lastName ?? '';
      case 'email': return contact.email ?? '';
      case 'phone_e164': return contact.phoneE164 ?? '';
      default: return contact.properties[key] ?? '';
    }
  }

  async function saveField(key: string, value: string) {
    if (!contact) return;
    const coreApiKey = CORE_FIELD_MAP[key];
    const body = coreApiKey
      ? { [coreApiKey]: value || undefined }
      : { properties: { [key]: value } };

    try {
      const updated = await api.patch(`/api/contacts/${id}`, body);
      setContact({ ...contact, ...updated, properties: { ...contact.properties, ...updated.properties } });
    } catch (err: any) {
      if (err.status === 409) alert('Aquest telèfon ja existeix en un altre contacte.');
      else if (err.status === 400) alert('Valor no vàlid.');
      else alert('Error en guardar. Torna-ho a intentar.');
    }
    setEditingKey(null);
  }

  function startInlineEdit(key: string) {
    setEditingKey(key);
    setEditingVal(getCoreValue(key));
  }

  // ─── Pin toggle (Option C) ────────────────────────────────────────────────

  function togglePin(key: string) {
    const next = pinnedKeys.includes(key)
      ? pinnedKeys.filter((k) => k !== key)
      : [...pinnedKeys, key].slice(0, 8);
    setPinnedKeys(next);
    api.patch('/api/contact-layout', { pinnedPropertyKeys: next });
  }

  // ─── Display helpers ──────────────────────────────────────────────────────

  const defFor = (key: string) => propDefs.find((d) => d.key === key);

  const displayVal = (key: string, val: string) => {
    const def = defFor(key);
    if (!def || !val) return val || '';
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
  const defGroupOrder: string[] = [];
  const groupMap = new Map<string, string[]>();

  for (const def of propDefs) {
    if (!def.group || CORE_KEYS.includes(def.key)) continue;
    if (!groupMap.has(def.group)) {
      groupMap.set(def.group, []);
      defGroupOrder.push(def.group);
    }
    groupMap.get(def.group)!.push(def.key);
  }

  for (const label of defGroupOrder) {
    displayGroups.push({ label, keys: groupMap.get(label)! });
  }

  // Sort groups by saved order (Option B)
  const sortedGroups = savedGroupOrder.length > 0
    ? [
        ...savedGroupOrder
          .map((label) => displayGroups.find((g) => g.label === label))
          .filter(Boolean) as typeof displayGroups,
        ...displayGroups.filter((g) => !savedGroupOrder.includes(g.label)),
      ]
    : displayGroups;

  const allGroupKeys = displayGroups.flatMap((g) => g.keys);

  // Other properties not in any group or core
  const otherKeys = Object.keys(contact.properties).filter(
    (k) => !CORE_KEYS.includes(k) && !allGroupKeys.includes(k),
  );

  // All non-core property keys for pin eligibility
  const allPropertyKeys = [...allGroupKeys, ...otherKeys];

  // ─── Drag handlers (Option B) ─────────────────────────────────────────────

  function handleDragEnd() {
    if (dragGroupIdx !== null && dragOverGroupIdx !== null && dragGroupIdx !== dragOverGroupIdx) {
      const next = sortedGroups.map((g) => g.label);
      const removed = next.splice(dragGroupIdx, 1);
      next.splice(dragOverGroupIdx, 0, removed[0]!);
      setSavedGroupOrder(next);
      api.patch('/api/contact-layout', { groupOrder: next });
    }
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
  }

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
            {/* Core fields — inline editable */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', marginTop: 12 }}>
              {CORE_KEYS.map((key) => {
                const def = defFor(key);
                const label = def?.label ?? key.replace(/_/g, ' ');
                const val = getCoreValue(key);
                return (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {label}
                    </div>
                    <InlineValue
                      propKey={key}
                      def={def ?? null}
                      value={val}
                      displayValue={key === 'phone_e164' ? val : displayVal(key, val)}
                      editingKey={editingKey}
                      editingVal={editingVal}
                      onStartEdit={startInlineEdit}
                      onChangeVal={setEditingVal}
                      onSave={saveField}
                      onCancel={() => setEditingKey(null)}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
              Creat el {fmtDate(contact.createdAt)}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                if (!contact || archiving) return;
                setArchiving(true);
                api.post(contact.archivedAt ? `/api/contacts/${id}/restore` : `/api/contacts/${id}/archive`)
                  .then((updated: any) => setContact({ ...contact, archivedAt: updated.archivedAt }))
                  .finally(() => setArchiving(false));
              }}
              disabled={archiving}
              style={{ ...outlineBtn, color: contact.archivedAt ? '#27ae60' : '#e74c3c', borderColor: contact.archivedAt ? '#27ae60' : '#e74c3c' }}
            >
              {archiving ? '...' : contact.archivedAt ? 'Restaurar' : 'Arxivar'}
            </button>
          </div>
        </div>
      </div>

      {/* Destacats card (Option C) */}
      {pinnedKeys.length > 0 && (
        <div
          style={{
            background: '#fffbeb', borderRadius: 10, padding: '20px 24px',
            border: '1px solid #fde68a', marginBottom: 16,
          }}
        >
          <h3 style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            ★ Destacats
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            {pinnedKeys.map((key) => {
              const def = defFor(key);
              if (!def) return null;
              const val = getCoreValue(key);
              return (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#92400e', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {def.label}
                  </div>
                  <InlineValue
                    propKey={key}
                    def={def}
                    value={val}
                    displayValue={displayVal(key, val)}
                    editingKey={editingKey}
                    editingVal={editingVal}
                    onStartEdit={startInlineEdit}
                    onChangeVal={setEditingVal}
                    onSave={saveField}
                    onCancel={() => setEditingKey(null)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Group cards — draggable (Option B) */}
      {sortedGroups.map((group, i) => {
        const keys = group.keys.filter((k) => defFor(k) !== undefined);
        if (keys.length === 0) return null;
        const isDragOver = dragOverGroupIdx === i && dragGroupIdx !== i;
        return (
          <div
            key={group.label || '__ungrouped__'}
            draggable
            onDragStart={() => setDragGroupIdx(i)}
            onDragOver={(e) => { e.preventDefault(); setDragOverGroupIdx(i); }}
            onDragEnd={handleDragEnd}
            style={{
              background: '#fff', borderRadius: 10, padding: '20px 24px',
              border: isDragOver ? '2px solid #93c5fd' : '1px solid var(--color-border)',
              marginBottom: 16,
              cursor: 'grab',
              opacity: dragGroupIdx === i ? 0.5 : 1,
              transition: 'border-color 0.15s, opacity 0.15s',
            }}
          >
            {group.label && (
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#ccc', fontSize: 16, cursor: 'grab' }} title="Arrossega per reordenar">≡</span>
                {group.label}
              </h3>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              {group.keys.map((key) => {
                const def = defFor(key);
                if (!def) return null;
                const val = contact.properties[key] ?? '';
                return (
                  <PropertyRow
                    key={key}
                    propKey={key}
                    def={def}
                    value={val}
                    editingKey={editingKey}
                    editingVal={editingVal}
                    onStartEdit={startInlineEdit}
                    onChangeVal={setEditingVal}
                    onSave={saveField}
                    onCancel={() => setEditingKey(null)}
                    isPinned={pinnedKeys.includes(key)}
                    onTogglePin={() => togglePin(key)}
                    displayVal={displayVal}
                  />
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
              return (
                <PropertyRow
                  key={key}
                  propKey={key}
                  def={def ?? null}
                  value={val}
                  editingKey={editingKey}
                  editingVal={editingVal}
                  onStartEdit={startInlineEdit}
                  onChangeVal={setEditingVal}
                  onSave={saveField}
                  onCancel={() => setEditingKey(null)}
                  isPinned={pinnedKeys.includes(key)}
                  onTogglePin={() => togglePin(key)}
                  displayVal={displayVal}
                />
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
              <Link
                key={d.dealId}
                to={`/deals/${d.dealId}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
              <div
                style={{
                  padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 6,
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: d.archivedAt ? 0.5 : 1, cursor: 'pointer',
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
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Workflows */}
      <ContactWorkflowsSection contactId={contact.id} />

      {/* Notes & Tasks */}
      <div style={{ marginTop: 20 }}>
        <NotesTasks objectType="contact" objectId={contact.id} />
      </div>
    </div>
  );
}

// ─── InlineValue — click-to-edit for a single value (Option A) ─────────────

function InlineValue({
  propKey,
  def,
  value,
  displayValue,
  editingKey,
  editingVal,
  onStartEdit,
  onChangeVal,
  onSave,
  onCancel,
}: {
  propKey: string;
  def: PropertyDef | null;
  value: string;
  displayValue: string;
  editingKey: string | null;
  editingVal: string;
  onStartEdit: (key: string) => void;
  onChangeVal: (v: string) => void;
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
}) {
  if (editingKey === propKey) {
    if (def?.type === 'select' && def.options) {
      return (
        <select
          value={editingVal}
          onChange={(e) => { onChangeVal(e.target.value); onSave(propKey, e.target.value); }}
          onBlur={() => onCancel()}
          autoFocus
          style={{ ...inputStyle, width: '100%' }}
        >
          <option value="">— Selecciona —</option>
          {def.options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      );
    }
    return def?.type === 'textarea' ? (
      <textarea
        value={editingVal}
        onChange={(e) => onChangeVal(e.target.value)}
        onBlur={() => onSave(propKey, editingVal)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        rows={3}
        autoFocus
        style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
      />
    ) : (
      <input
        type="text"
        value={editingVal}
        onChange={(e) => onChangeVal(e.target.value)}
        onBlur={() => onSave(propKey, editingVal)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(propKey, editingVal);
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
        style={{ ...inputStyle, width: '100%' }}
      />
    );
  }

  return (
    <span
      onClick={() => onStartEdit(propKey)}
      title="Clic per editar"
      style={{
        cursor: 'pointer', display: 'block', minHeight: '1.5rem',
        padding: '2px 4px', margin: '-2px -4px', borderRadius: 4,
        fontSize: 13, transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {displayValue || <span style={{ color: '#ccc', fontStyle: 'italic', fontSize: 12 }}>—</span>}
    </span>
  );
}

// ─── PropertyRow — label + star + inline value ─────────────────────────────

function PropertyRow({
  propKey,
  def,
  value,
  editingKey,
  editingVal,
  onStartEdit,
  onChangeVal,
  onSave,
  onCancel,
  isPinned,
  onTogglePin,
  displayVal,
}: {
  propKey: string;
  def: PropertyDef | null;
  value: string;
  editingKey: string | null;
  editingVal: string;
  onStartEdit: (key: string) => void;
  onChangeVal: (v: string) => void;
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  displayVal: (key: string, val: string) => string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, display: 'flex', alignItems: 'center' }}>
        {def?.label ?? propKey}
        {def?.isSensitive && <span style={{ marginLeft: 4, color: '#e74c3c' }}>🔒</span>}
        <button
          onClick={onTogglePin}
          title={isPinned ? 'Treure de Destacats' : 'Afegir a Destacats'}
          style={{
            marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, padding: '0 2px', lineHeight: 1,
            color: isPinned ? '#f59e0b' : '#d1d5db',
            opacity: isPinned ? 1 : 0.4,
            transition: 'opacity 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = isPinned ? '1' : '0.4')}
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
      <InlineValue
        propKey={propKey}
        def={def}
        value={value}
        displayValue={displayVal(propKey, value)}
        editingKey={editingKey}
        editingVal={editingVal}
        onStartEdit={onStartEdit}
        onChangeVal={onChangeVal}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}

// ─── ContactWorkflowsSection ────────────────────────────────────────────────

function ContactWorkflowsSection({ contactId }: { contactId: string }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.get(`/api/contacts/${contactId}/workflow-history`)
      .then((res) => setHistory(res.data ?? res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contactId]);

  return (
    <div style={{ marginTop: 20, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: '14px 18px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Workflows</h3>
        <span style={{ fontSize: 12, color: '#888' }}>{loading ? '...' : `${history.length} execuci${history.length === 1 ? 'ó' : 'ons'}`}</span>
      </div>
      {expanded && !loading && (
        history.length === 0 ? (
          <div style={{ padding: '12px 0', color: '#888', fontSize: 13 }}>Cap workflow per a aquest contacte.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600, color: '#666' }}>Workflow</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, color: '#666' }}>Estat</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, color: '#666' }}>Inici</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, color: '#666' }}>Fi</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r: any) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f3f3' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.workflowName ?? r.workflowId}</td>
                  <td style={{ padding: '6px 8px' }}>{r.status}</td>
                  <td style={{ padding: '6px 8px', color: '#888' }}>{new Date(r.startedAt).toLocaleDateString('ca-ES')}</td>
                  <td style={{ padding: '6px 8px', color: '#888' }}>{r.completedAt ? new Date(r.completedAt).toLocaleDateString('ca-ES') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--color-border)',
  borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
