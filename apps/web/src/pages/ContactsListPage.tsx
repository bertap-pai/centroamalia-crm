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

const CONTACT_FIXED_COLS: Array<{ key: string; label: string; sortField?: string }> = [
  { key: '_nom',     label: 'Nom',     sortField: 'first_name' },
  { key: '_telefon', label: 'Telèfon', sortField: 'phone_e164' },
  { key: '_email',   label: 'Email',   sortField: 'email' },
  { key: '_creat',   label: 'Creat',   sortField: 'created_at' },
];
const CONTACT_FIXED_KEYS = new Set(CONTACT_FIXED_COLS.map((c) => c.key));

const DEFAULT_ALL_COLUMNS = ['_nom', '_telefon', '_email', ...DEFAULT_PROP_COLUMNS, '_creat'];

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
  const [allColumns, setAllColumns] = useState<string[]>(DEFAULT_ALL_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [showSaveView, setShowSaveView] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter / sort / pagination state
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Advanced filters
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [propFilters, setPropFilters] = useState<Record<string, string>>({});

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dragColRef = useRef<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [refreshKey, setRefreshKey] = useState(0);

  // Derived: prop-only keys (fixed keys excluded)
  const propColumns = allColumns.filter((k) => !CONTACT_FIXED_KEYS.has(k));

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
    params.set('sort', sortField);
    params.set('sortDir', sortDir);
    if (propColumns.length > 0) params.set('columns', propColumns.join(','));
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    for (const [key, val] of Object.entries(propFilters)) {
      if (val) params.set(`filter[${key}]`, val);
    }

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
  }, [debouncedSearch, includeArchived, page, allColumns, createdFrom, createdTo, propFilters, sortField, sortDir, refreshKey]);

  function applyView(view: SavedView) {
    setActiveViewId(view.id);
    if (view.config.columns) setAllColumns(view.config.columns);
    if (view.config.sort) setSortField(view.config.sort);
    if (view.config.sortDir) setSortDir(view.config.sortDir);
    if (view.config.filters) {
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
        config: { columns: allColumns, sort: sortField, sortDir },
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

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  }

  function clearFilters() {
    setCreatedFrom('');
    setCreatedTo('');
    setPropFilters({});
    setPage(1);
  }

  const activeFilterCount = [
    createdFrom || createdTo ? 1 : 0,
    ...Object.values(propFilters).map((v) => (v ? 1 : 0)),
  ].reduce((a, b) => a + b, 0);

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

  // Property defs suitable for filtering (exclude base fields, keep filterable types)
  const filterablePropDefs = propertyDefs.filter(
    (d) => !['first_name', 'last_name', 'email', 'phone_e164'].includes(d.key),
  );

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

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilterBar(!showFilterBar)}
            style={{
              ...outlineBtn,
              background: activeFilterCount > 0 ? '#eef2ff' : '#fff',
              borderColor: activeFilterCount > 0 ? 'var(--color-primary)' : 'var(--color-border)',
              color: activeFilterCount > 0 ? 'var(--color-primary)' : '#555',
            }}
          >
            Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} ▾
          </button>

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
                onChange={(newPropCols) => {
                  // Rebuild allColumns: keep fixed cols in current position, replace dynamic portion
                  setAllColumns((prev) => {
                    // Remove any prop keys no longer selected
                    const filtered = prev.filter((k) => CONTACT_FIXED_KEYS.has(k) || newPropCols.includes(k));
                    // Append newly added prop keys before _creat
                    const creatIdx = filtered.indexOf('_creat');
                    const ins = creatIdx >= 0 ? creatIdx : filtered.length;
                    const added = newPropCols.filter((k) => !filtered.includes(k));
                    return [...filtered.slice(0, ins), ...added, ...filtered.slice(ins)];
                  });
                  setShowColumnPicker(false);
                }}
                onClose={() => setShowColumnPicker(false)}
              />
            )}
          </div>

          {/* Save view */}
          <button onClick={() => setShowSaveView(!showSaveView)} style={outlineBtn}>
            Guardar vista
          </button>
        </div>

        {/* Filter bar */}
        {showFilterBar && (
          <div
            style={{
              marginTop: 10, padding: '16px 20px', background: '#f9f9fb',
              border: '1px solid var(--color-border)', borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            {/* Date range — full-width row */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data creació</span>
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }}
                style={{ ...inputStyle, fontSize: 13, padding: '6px 8px' }}
              />
              <span style={{ fontSize: 12, color: '#888' }}>fins</span>
              <input
                type="date"
                value={createdTo}
                onChange={(e) => { setCreatedTo(e.target.value); setPage(1); }}
                style={{ ...inputStyle, fontSize: 13, padding: '6px 8px' }}
              />
            </div>

            {/* Property filters */}
            {filterablePropDefs.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 16px', alignItems: 'end' }}>
                {filterablePropDefs.map((def) => (
                  <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {def.label}
                    </label>
                    {def.type === 'select' || def.type === 'multiselect' ? (
                      <select
                        value={propFilters[def.key] ?? ''}
                        onChange={(e) => {
                          setPropFilters((prev) => {
                            const next = { ...prev };
                            if (e.target.value) next[def.key] = e.target.value;
                            else delete next[def.key];
                            return next;
                          });
                          setPage(1);
                        }}
                        style={{ ...inputStyle, width: '100%', fontSize: 13, padding: '6px 8px' }}
                      >
                        <option value="">Tots</option>
                        {def.options?.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    ) : def.type === 'date' || def.type === 'datetime' ? (
                      <input
                        type="date"
                        value={propFilters[def.key] ?? ''}
                        onChange={(e) => {
                          setPropFilters((prev) => {
                            const next = { ...prev };
                            if (e.target.value) next[def.key] = e.target.value;
                            else delete next[def.key];
                            return next;
                          });
                          setPage(1);
                        }}
                        style={{ ...inputStyle, width: '100%', fontSize: 13, padding: '6px 8px' }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={propFilters[def.key] ?? ''}
                        placeholder={`Filtra per ${def.label.toLowerCase()}...`}
                        onChange={(e) => {
                          setPropFilters((prev) => {
                            const next = { ...prev };
                            if (e.target.value) next[def.key] = e.target.value;
                            else delete next[def.key];
                            return next;
                          });
                          setPage(1);
                        }}
                        style={{ ...inputStyle, width: '100%', fontSize: 13, padding: '6px 8px' }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeFilterCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={clearFilters} style={{ ...outlineBtn, fontSize: 12, padding: '4px 10px', color: '#e74c3c', borderColor: '#e74c3c' }}>
                  Esborrar filtres
                </button>
              </div>
            )}
          </div>
        )}

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
            onClick={() => { setActiveViewId(null); setAllColumns(DEFAULT_ALL_COLUMNS); setSearch(''); setPage(1); }}
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
                {allColumns.map((key) => {
                  const fixed = CONTACT_FIXED_COLS.find((c) => c.key === key);
                  return (
                    <ColTh
                      key={key}
                      colKey={key}
                      label={fixed ? fixed.label : propLabel(key)}
                      sortField={fixed?.sortField}
                      activeSortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                      allColumns={allColumns}
                      setAllColumns={setAllColumns}
                      dragColRef={dragColRef}
                    />
                  );
                })}
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
                  {allColumns.map((key) => {
                    const isFixed = CONTACT_FIXED_KEYS.has(key);
                    if (isFixed) {
                      if (key === '_nom') return (
                        <Td key={key}>
                          <span style={{ fontWeight: 500 }}>{displayName(c)}</span>
                          {c.archivedAt && <span style={{ marginLeft: 6, fontSize: 10, color: '#999', background: '#eee', borderRadius: 3, padding: '1px 4px' }}>arxivat</span>}
                        </Td>
                      );
                      if (key === '_telefon') return <Td key={key}>{c.phoneE164 ?? '—'}</Td>;
                      if (key === '_email') return <Td key={key}>{c.email ?? '—'}</Td>;
                      if (key === '_creat') return <Td key={key}>{fmtDate(c.createdAt)}</Td>;
                    }
                    return <Td key={key}>{c.properties[key] ? propOptionLabel(key, c.properties[key]) : '—'}</Td>;
                  })}
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
            setRefreshKey((k) => k + 1);
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

function ColTh({
  colKey, label, sortField, activeSortField, sortDir, onSort, allColumns, setAllColumns, dragColRef,
}: {
  colKey: string;
  label: string;
  sortField?: string;
  activeSortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (f: string) => void;
  allColumns: string[];
  setAllColumns: React.Dispatch<React.SetStateAction<string[]>>;
  dragColRef: React.MutableRefObject<string | null>;
}) {
  const isActive = !!sortField && activeSortField === sortField;

  function handleDragStart() { dragColRef.current = colKey; }
  function handleDrop() {
    const from = dragColRef.current;
    dragColRef.current = null;
    if (!from || from === colKey) return;
    setAllColumns((prev) => {
      const cols = [...prev];
      const fi = cols.indexOf(from);
      const ti = cols.indexOf(colKey);
      if (fi === -1 || ti === -1) return prev;
      cols.splice(fi, 1);
      cols.splice(ti, 0, from);
      return cols;
    });
  }

  return (
    <th
      draggable
      onDragStart={handleDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={sortField ? () => onSort(sortField) : undefined}
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 0.5,
        background: '#f9f9f9', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0,
        cursor: sortField ? 'pointer' : 'grab',
        userSelect: 'none', whiteSpace: 'nowrap',
        color: isActive ? 'var(--color-primary)' : '#888',
      }}
    >
      {label}
      {sortField ? (isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : ''}
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
