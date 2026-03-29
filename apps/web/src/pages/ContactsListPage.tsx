import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import ContactQuickCreateModal from '../components/ContactQuickCreateModal.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  phoneE164: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: string;
  archivedAt: string | null;
  properties: Record<string, string>;
}

interface ListResp {
  data: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  options: Array<{ key: string; label: string }> | null;
  scope: string;
}

interface SavedView {
  id: string;
  name: string;
  isTeam: boolean;
  createdByUserId: string | null;
  config: {
    columns?: string[];
    filters?: Record<string, string>;
    sort?: string;
    sortDir?: 'asc' | 'desc';
  };
}

// Default columns shown in the table (keys of property values; base fields handled separately)
const DEFAULT_PROP_COLUMNS = ['servei_interes', 'last_lead_source'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContactsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [propColumns, setPropColumns] = useState<string[]>(DEFAULT_PROP_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [showSaveView, setShowSaveView] = useState(false);

  // Filter / sort / pagination state
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Load property defs + saved views once
  useEffect(() => {
    api.get('/api/properties?scope=contact').then(setPropertyDefs).catch(() => {});
    api.get('/api/saved-views?objectType=contact').then(setSavedViews).catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  // Fetch contacts
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (includeArchived) params.set('includeArchived', 'true');
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (propColumns.length > 0) params.set('columns', propColumns.join(','));

    api
      .get(`/api/contacts?${params}`)
      .then((resp: ListResp) => {
        if (!cancelled) {
          setContacts(resp.data);
          setTotal(resp.total);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err.message ?? 'Error en carregar contactes.');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [debouncedSearch, includeArchived, page, propColumns]);

  function applyView(view: SavedView) {
    setActiveViewId(view.id);
    if (view.config.columns) setPropColumns(view.config.columns);
    if (view.config.filters) {
      // Apply basic search from filters if present
      const q = (view.config.filters as any)['q'];
      if (q) setSearch(q);
    }
    setPage(1);
  }

  async function handleSaveView(isTeam: boolean) {
    if (!viewName.trim()) return;
    setSavingView(true);
    try {
      const view = await api.post('/api/saved-views', {
        name: viewName.trim(),
        objectType: 'contact',
        config: { columns: propColumns },
        isTeam,
      });
      setSavedViews((prev) => [...prev, view]);
      setActiveViewId(view.id);
      setShowSaveView(false);
      setViewName('');
    } finally {
      setSavingView(false);
    }
  }

  async function handleDeleteView(id: string) {
    await api.delete(`/api/saved-views/${id}`);
    setSavedViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(null);
  }

  const displayName = (c: Contact) => {
    const n = [c.firstName, c.lastName].filter(Boolean).join(' ');
    return n || <span style={{ color: '#999' }}>Sense nom</span>;
  };

  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    return new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s));
  };

  const propLabel = (key: string) => propertyDefs.find((d) => d.key === key)?.label ?? key;

  const propOptionLabel = (key: string, val: string) => {
    const def = propertyDefs.find((d) => d.key === key);
    if (!def?.options) return val;
    return def.options.find((o) => o.key === val)?.label ?? val;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Contactes</h1>
          <span style={{ color: '#999', fontSize: 13 }}>{total > 0 ? `${total} total` : ''}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowCreate(true)} style={primaryBtn}>
            + Nou contacte
          </button>
        </div>

        {/* Search + controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Cerca per nom, telèfon, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{
              flex: 1, maxWidth: 320, padding: '7px 12px', border: '1px solid var(--color-border)',
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }}
            />
            Incloure arxivats
          </label>

          {/* Column picker */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              style={outlineBtn}
            >
              Columnes ▾
            </button>
            {showColumnPicker && (
              <ColumnPicker
                defs={propertyDefs.filter((d) => !['first_name','last_name','email','phone_e164'].includes(d.key))}
                selected={propColumns}
                onChange={(cols) => { setPropColumns(cols); setShowColumnPicker(false); }}
                onClose={() => setShowColumnPicker(false)}
              />
            )}
          </div>

          {/* Save view */}
          <button onClick={() => setShowSaveView(!showSaveView)} style={outlineBtn}>
            Guardar vista
          </button>
        </div>

        {/* Save view panel */}
        {showSaveView && (
          <div
            style={{
              marginTop: 10, padding: '12px 14px', background: '#fafafa',
              border: '1px solid var(--color-border)', borderRadius: 6,
              display: 'flex', gap: 8, alignItems: 'center',
            }}
          >
            <input
              type="text"
              placeholder="Nom de la vista"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              style={{ ...inputStyle, maxWidth: 200 }}
              autoFocus
            />
            <button disabled={savingView || !viewName.trim()} onClick={() => handleSaveView(false)} style={primaryBtn}>
              Personal
            </button>
            {user?.role === 'admin' && (
              <button disabled={savingView || !viewName.trim()} onClick={() => handleSaveView(true)} style={outlineBtn}>
                D'equip
              </button>
            )}
            <button onClick={() => { setShowSaveView(false); setViewName(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>
              ×
            </button>
          </div>
        )}
      </div>

      {/* Saved views tabs */}
      {savedViews.length > 0 && (
        <div
          style={{
            display: 'flex', gap: 4, padding: '8px 24px 0',
            background: '#fff', borderBottom: '1px solid var(--color-border)',
            overflowX: 'auto', flexShrink: 0,
          }}
        >
          <button
            onClick={() => { setActiveViewId(null); setPropColumns(DEFAULT_PROP_COLUMNS); setSearch(''); setPage(1); }}
            style={tabStyle(activeViewId === null)}
          >
            Tots
          </button>
          {savedViews.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button onClick={() => applyView(v)} style={tabStyle(activeViewId === v.id)}>
                {v.isTeam ? '👥 ' : ''}
                {v.name}
              </button>
              {(v.createdByUserId === user?.id || (v.isTeam && user?.role === 'admin')) && (
                <button
                  onClick={() => handleDeleteView(v.id)}
                  title="Eliminar vista"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 12, padding: '0 4px' }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
        {loading ? (
          <div style={{ padding: 32, color: '#999', textAlign: 'center' }}>Carregant...</div>
        ) : error ? (
          <div style={{ padding: 32, color: 'var(--color-error)' }}>{error}</div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
            <div>Cap contacte trobat.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Nom</Th>
                <Th>Telèfon</Th>
                <Th>Email</Th>
                {propColumns.map((key) => (
                  <Th key={key}>{propLabel(key)}</Th>
                ))}
                <Th>Creat</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/contacts/${c.id}`)}
                  style={{
                    cursor: 'pointer',
                    opacity: c.archivedAt ? 0.5 : 1,
                    borderBottom: '1px solid var(--color-border)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#fafafa'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <Td>
                    <span style={{ fontWeight: 500 }}>{displayName(c)}</span>
                    {c.archivedAt && <span style={{ marginLeft: 6, fontSize: 10, color: '#999', background: '#eee', borderRadius: 3, padding: '1px 4px' }}>arxivat</span>}
                  </Td>
                  <Td>{c.phoneE164 ?? '—'}</Td>
                  <Td>{c.email ?? '—'}</Td>
                  {propColumns.map((key) => (
                    <Td key={key}>{c.properties[key] ? propOptionLabel(key, c.properties[key]) : '—'}</Td>
                  ))}
                  <Td>{fmtDate(c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            padding: '12px 24px', borderTop: '1px solid var(--color-border)',
            background: '#fff', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end',
          }}
        >
          <button disabled={page === 1} onClick={() => setPage(page - 1)} style={outlineBtn}>
            ← Anterior
          </button>
          <span style={{ fontSize: 13, color: '#666' }}>
            {page} / {totalPages}
          </span>
          <button disabled={page === totalPages} onClick={() => setPage(page + 1)} style={outlineBtn}>
            Següent →
          </button>
        </div>
      )}

      {/* Quick create modal */}
      {showCreate && (
        <ContactQuickCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setPage(1);
            setDebouncedSearch(search + ' ');  // force re-fetch
            setTimeout(() => setDebouncedSearch(search), 50);
          }}
        />
      )}
    </div>
  );
}

// ─── Column Picker ─────────────────────────────────────────────────────────────

function ColumnPicker({
  defs,
  selected,
  onChange,
  onClose,
}: {
  defs: PropertyDef[];
  selected: string[];
  onChange: (cols: string[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(new Set(selected));

  function toggle(key: string) {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setChecked(next);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
      <div
        style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8,
          boxShadow: 'var(--shadow-md)', padding: 12, zIndex: 51, width: 240,
          maxHeight: 320, overflowY: 'auto',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#999', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Columnes de propietats
        </div>
        {defs.map((d) => (
          <label
            key={d.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={checked.has(d.key)}
              onChange={() => toggle(d.key)}
            />
            {d.label}
          </label>
        ))}
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => onChange([...checked])} style={primaryBtn}>
            Aplicar
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        color: '#888', textTransform: 'uppercase', letterSpacing: 0.5,
        background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '10px 12px', color: '#333', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </td>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
  padding: '8px 14px', fontWeight: active ? 600 : 400,
  color: active ? 'var(--color-primary)' : '#555',
  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
  fontFamily: 'inherit', whiteSpace: 'nowrap',
});

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
};
