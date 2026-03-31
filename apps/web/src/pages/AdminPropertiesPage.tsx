import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  scope: 'contact' | 'deal' | 'both';
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
  options: Array<{ key: string; label: string }> | null;
  isRequired: boolean;
  isInternalOnly: boolean;
  isSensitive: boolean;
  position: string;
  createdAt: string;
}

const SCOPE_LABELS: Record<string, string> = {
  contact: 'Contacte',
  deal: 'Deal',
  both: 'Ambdós',
};

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  textarea: 'Àrea de text',
  number: 'Nombre',
  boolean: 'Sí / No',
  date: 'Data',
  datetime: 'Data i hora',
  select: 'Selecció',
  multiselect: 'Selecció múltiple',
};

const SCOPES = ['contact', 'deal', 'both'] as const;
const TYPES = ['text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect'] as const;

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPropertiesPage() {
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'contact' | 'deal' | 'both'>('all');

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Confirm delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .get('/api/properties?scope=all')
      .then((data: PropertyDef[]) => {
        setDefs(data);
        setLoading(false);
      })
      .catch((e: any) => {
        setError(e.message ?? 'Error');
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, []);

  const displayed = scopeFilter === 'all'
    ? defs
    : defs.filter((d) => d.scope === scopeFilter);

  function startCreate() {
    setForm(emptyForm());
    setFormError('');
    setEditingId(null);
    setShowCreate(true);
  }

  function startEdit(def: PropertyDef) {
    setForm({
      key: def.key,
      label: def.label,
      scope: def.scope,
      type: def.type,
      options: def.options ? def.options.map((o) => ({ ...o })) : [],
      isRequired: def.isRequired,
      isInternalOnly: def.isInternalOnly,
      isSensitive: def.isSensitive,
      position: def.position,
    });
    setFormError('');
    setEditingId(def.id);
    setShowCreate(true);
  }

  function cancelForm() {
    setShowCreate(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.key.trim() || !form.label.trim()) {
      setFormError('La clau i l\'etiqueta són obligatòries.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        key: form.key.trim(),
        label: form.label.trim(),
        scope: form.scope,
        type: form.type,
        options: (form.type === 'select' || form.type === 'multiselect') ? form.options : [],
        isRequired: form.isRequired,
        isInternalOnly: form.isInternalOnly,
        isSensitive: form.isSensitive,
        position: form.position,
      };

      if (editingId) {
        const updated: PropertyDef = await api.patch(`/api/properties/${editingId}`, payload);
        setDefs((prev) => prev.map((d) => d.id === editingId ? updated : d));
      } else {
        const created: PropertyDef = await api.post('/api/properties', payload);
        setDefs((prev) => [...prev, created]);
      }
      cancelForm();
    } catch (e: any) {
      setFormError(e.message ?? 'Error en guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/properties/${id}`);
      setDefs((prev) => prev.filter((d) => d.id !== id));
    } catch (e: any) {
      alert(e.message ?? 'Error en eliminar.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Propietats dinàmiques</h1>
        <span style={{ color: '#999', fontSize: 13 }}>{defs.length} definicions</span>
        <div style={{ flex: 1 }} />
        <button onClick={startCreate} style={primaryBtn}>+ Nova propietat</button>
      </div>

      {/* Scope filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        {(['all', 'contact', 'deal', 'both'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScopeFilter(s)}
            style={tabStyle(scopeFilter === s)}
          >
            {s === 'all' ? 'Totes' : SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <div style={{ color: 'var(--color-error)', marginBottom: 12 }}>{error}</div>}

      {/* Table */}
      {loading ? (
        <div style={{ color: '#999', padding: 32 }}>Carregant...</div>
      ) : displayed.length === 0 ? (
        <div style={{ color: '#999', padding: 32, textAlign: 'center' }}>Cap propietat definida.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <Th>Clau</Th>
              <Th>Etiqueta</Th>
              <Th>Àmbit</Th>
              <Th>Tipus</Th>
              <Th>Flags</Th>
              <Th>Opcions</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((def) => (
              <tr key={def.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <Td>
                  <code style={{ fontSize: 12, background: '#f0f0f0', padding: '2px 5px', borderRadius: 3 }}>
                    {def.key}
                  </code>
                </Td>
                <Td>{def.label}</Td>
                <Td>
                  <ScopeBadge scope={def.scope} />
                </Td>
                <Td>
                  <span style={{ color: '#555' }}>{TYPE_LABELS[def.type] ?? def.type}</span>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {def.isRequired && <Badge color="#e87d52">Obligatori</Badge>}
                    {def.isSensitive && <Badge color="#8b5cf6">Sensible</Badge>}
                    {def.isInternalOnly && <Badge color="#64748b">Intern</Badge>}
                  </div>
                </Td>
                <Td>
                  {def.options && def.options.length > 0
                    ? <span style={{ color: '#888' }}>{def.options.length} opcions</span>
                    : <span style={{ color: '#ccc' }}>—</span>
                  }
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEdit(def)} style={smallBtn}>Editar</button>
                    {deletingId === def.id ? (
                      <>
                        <button onClick={() => handleDelete(def.id)} style={{ ...smallBtn, color: 'var(--color-error)', borderColor: 'var(--color-error)' }}>
                          Confirmar
                        </button>
                        <button onClick={() => setDeletingId(null)} style={smallBtn}>Cancel·lar</button>
                      </>
                    ) : (
                      <button onClick={() => setDeletingId(def.id)} style={{ ...smallBtn, color: '#999' }}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create / Edit modal */}
      {showCreate && (
        <Modal title={editingId ? 'Editar propietat' : 'Nova propietat'} onClose={cancelForm}>
          <form onSubmit={handleSubmit}>
            <Field label="Clau (key)">
              <input
                type="text"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="p.ex. lead_source"
                disabled={!!editingId}
                style={{ ...inputStyle, width: '100%' }}
                autoFocus
              />
              {!editingId && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>
                  Slug únic — no es pot canviar un cop creat.
                </div>
              )}
            </Field>

            <Field label="Etiqueta">
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="p.ex. Font del lead"
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Àmbit">
                <select
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                  ))}
                </select>
              </Field>

              <Field label="Tipus">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Posició (ordre)">
              <input
                type="text"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                placeholder="p.ex. 010, 020..."
                style={{ ...inputStyle, width: '100%' }}
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                Determina l'ordre en què apareix el camp dins la seva secció. Valors més petits apareixen primer (010 abans que 020).
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <label style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.isRequired}
                  onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
                />
                Obligatori
              </label>
              <label style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.isSensitive}
                  onChange={(e) => setForm({ ...form, isSensitive: e.target.checked })}
                />
                Dades sensibles
              </label>
              <label style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.isInternalOnly}
                  onChange={(e) => setForm({ ...form, isInternalOnly: e.target.checked })}
                />
                Només intern
              </label>
            </div>

            {/* Options editor — only for select/multiselect */}
            {(form.type === 'select' || form.type === 'multiselect') && (
              <Field label="Opcions">
                <OptionsEditor
                  options={form.options}
                  onChange={(options) => setForm({ ...form, options })}
                />
              </Field>
            )}

            {formError && (
              <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 12 }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={cancelForm} style={outlineBtn}>Cancel·lar</button>
              <button type="submit" disabled={saving} style={primaryBtn}>
                {saving ? 'Guardant...' : editingId ? 'Guardar canvis' : 'Crear propietat'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Options editor ────────────────────────────────────────────────────────────

function OptionsEditor({
  options,
  onChange,
}: {
  options: Array<{ key: string; label: string }>;
  onChange: (opts: Array<{ key: string; label: string }>) => void;
}) {
  function update(idx: number, field: 'key' | 'label', val: string) {
    const next = options.map((o, i) => i === idx ? { ...o, [field]: val } : o);
    onChange(next);
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...options, { key: '', label: '' }]);
  }

  return (
    <div>
      {options.map((opt, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={opt.key}
            onChange={(e) => update(idx, 'key', e.target.value)}
            placeholder="clau"
            style={{ ...inputStyle, width: 140 }}
          />
          <input
            type="text"
            value={opt.label}
            onChange={(e) => update(idx, 'label', e.target.value)}
            placeholder="etiqueta"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" onClick={() => remove(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16 }}>
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...outlineBtn, fontSize: 12, padding: '4px 10px' }}>
        + Afegir opció
      </button>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}
      />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: '#fff', borderRadius: 10, padding: 24, zIndex: 101,
          width: '90%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 18 }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const colors: Record<string, string> = { contact: '#0ea5e9', deal: '#10b981', both: '#8b5cf6' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
      background: `${colors[scope] ?? '#999'}22`, color: colors[scope] ?? '#999',
    }}>
      {SCOPE_LABELS[scope] ?? scope}
    </span>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
      background: `${color}22`, color,
    }}>
      {children}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
      color: '#888', textTransform: 'uppercase', letterSpacing: 0.5,
      background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
    }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '9px 12px', color: '#333' }}>
      {children}
    </td>
  );
}

// ─── Form state ────────────────────────────────────────────────────────────────

type FormState = {
  key: string;
  label: string;
  scope: 'contact' | 'deal' | 'both';
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
  options: Array<{ key: string; label: string }>;
  isRequired: boolean;
  isInternalOnly: boolean;
  isSensitive: boolean;
  position: string;
};

function emptyForm(): FormState {
  return {
    key: '',
    label: '',
    scope: 'contact',
    type: 'text',
    options: [],
    isRequired: false,
    isInternalOnly: false,
    isSensitive: false,
    position: '',
  };
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};

const smallBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

const checkboxLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
  padding: '8px 14px', fontWeight: active ? 600 : 400,
  color: active ? 'var(--color-primary)' : '#555',
  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
  fontFamily: 'inherit',
});
