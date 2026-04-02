import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import DealCreateModal from '../components/DealCreateModal.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrimaryContact {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
}

interface Deal {
  id: string;
  pipelineId: string;
  stageId: string;
  ownerUserId: string | null;
  isClosedWon: boolean;
  isClosedLost: boolean;
  currentStageEnteredAt: string;
  createdAt: string;
  archivedAt: string | null;
  primaryContact: PrimaryContact | null;
  pipelineName: string | null;
  pipelineSlug: string | null;
  stageName: string | null;
  stageSlug: string | null;
  ownerName: string | null;
  properties: Record<string, string>;
}

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
  position: number;
  defaultView: 'list' | 'kanban';
  stages: Stage[];
}

interface SavedView {
  id: string;
  name: string;
  isTeam: boolean;
  createdByUserId: string | null;
  config: {
    columns?: string[];
    filters?: {
      stageId?: string;
      ownerUserId?: string;
      createdFrom?: string;
      createdTo?: string;
      propFilters?: Record<string, string>;
    };
    sort?: string;
    sortDir?: 'asc' | 'desc';
    viewMode?: 'list' | 'kanban';
  };
}

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  scope: string;
  options: Array<{ key: string; label: string }> | null;
}

interface UserOption {
  id: string;
  name: string | null;
}

interface KanbanStage extends Stage {
  deals: (Deal & { primaryContact: PrimaryContact | null; ownerName: string | null })[];
}

type ViewMode = 'list' | 'kanban';

const DEAL_FIXED_COLS: Array<{ key: string; label: string; sortField?: string }> = [
  { key: '_contacte',    label: 'Contacte',        sortField: 'contact_first_name' },
  { key: '_telefon',     label: 'Telèfon',          sortField: 'contact_phone_e164' },
  { key: '_etapa',       label: 'Pipeline · Etapa', sortField: 'current_stage_entered_at' },
  { key: '_responsable', label: 'Responsable',      sortField: 'owner_name' },
  { key: '_creat',       label: 'Creat',            sortField: 'created_at' },
];
const DEAL_FIXED_KEYS = new Set(DEAL_FIXED_COLS.map((c) => c.key));

const DEFAULT_DEAL_COLUMNS = DEAL_FIXED_COLS.map((c) => c.key);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DealsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [showSaveView, setShowSaveView] = useState(false);

  // Sort
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showCreate, setShowCreate] = useState(false);

  // List state
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [allColumns, setAllColumns] = useState<string[]>(DEFAULT_DEAL_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);

  // Advanced filters
  const [filterStageId, setFilterStageId] = useState('');
  const [filterOwnerUserId, setFilterOwnerUserId] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [propFilters, setPropFilters] = useState<Record<string, string>>({});

  // Kanban state
  const [kanbanData, setKanbanData] = useState<{ pipeline: Pipeline; stages: KanbanStage[] } | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [stageTransitionModal, setStageTransitionModal] = useState<{
    dealId: string;
    targetStageId: string;
    missingFields: string[];
  } | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Derived: prop-only keys (fixed keys excluded)
  const propColumns = allColumns.filter((k) => !DEAL_FIXED_KEYS.has(k));

  // Load pipelines + property defs + users + saved views once
  useEffect(() => {
    Promise.all([
      api.get('/api/pipelines'),
      api.get('/api/properties?scope=deal'),
      api.get('/api/users'),
      api.get('/api/saved-views?objectType=deal'),
    ]).then(([ps, defs, us, views]) => {
      setPipelines(ps);
      setPropertyDefs(defs);
      setUsers(us);
      setSavedViews(views ?? []);
      if (ps.length > 0) {
        setSelectedPipelineId(ps[0].id);
        setViewMode(ps[0].defaultView ?? 'kanban');
      }
    }).catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  // Fetch list
  useEffect(() => {
    if (viewMode !== 'list') return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortField,
      sortDir,
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(includeArchived ? { includeArchived: 'true' } : {}),
      ...(selectedPipelineId ? { pipelineId: selectedPipelineId } : {}),
      ...(propColumns.length > 0 ? { columns: propColumns.join(',') } : {}),
      ...(filterStageId ? { stageId: filterStageId } : {}),
      ...(filterOwnerUserId ? { ownerUserId: filterOwnerUserId } : {}),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
    });
    for (const [key, val] of Object.entries(propFilters)) {
      if (val) params.set(`filter[${key}]`, val);
    }

    api.get(`/api/deals?${params}`)
      .then((res) => {
        if (!cancelled) {
          setDeals(res.data ?? []);
          setTotal(res.total ?? 0);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err.message ?? 'Error en carregar els deals.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [viewMode, debouncedSearch, includeArchived, page, selectedPipelineId, allColumns,
      filterStageId, filterOwnerUserId, createdFrom, createdTo, propFilters, sortField, sortDir]);

  function buildKanbanParams() {
    const params = new URLSearchParams({ pipelineId: selectedPipelineId });
    if (includeArchived) params.set('includeArchived', 'true');
    if (filterOwnerUserId) params.set('ownerUserId', filterOwnerUserId);
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    for (const [key, val] of Object.entries(propFilters)) {
      if (val) params.set(`filter[${key}]`, val);
    }
    return params.toString();
  }

  function refreshKanban() {
    if (!selectedPipelineId) return;
    api.get(`/api/deals/kanban?${buildKanbanParams()}`)
      .then(setKanbanData)
      .catch(() => {});
  }

  // Fetch kanban
  useEffect(() => {
    if (viewMode !== 'kanban' || !selectedPipelineId) return;
    setKanbanLoading(true);
    api.get(`/api/deals/kanban?${buildKanbanParams()}`)
      .then((res) => {
        setKanbanData(res);
        setKanbanLoading(false);
      })
      .catch(() => setKanbanLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedPipelineId, includeArchived, filterOwnerUserId, createdFrom, createdTo, propFilters]);

  // Drag & drop handlers
  function handleDragStart(dealId: string) {
    setDraggingDealId(dealId);
    setStageTransitionModal(null);
  }

  function handleDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    setDragOverStageId(stageId);
  }

  async function handleDrop(e: React.DragEvent, targetStageId: string) {
    e.preventDefault();
    setDragOverStageId(null);
    if (!draggingDealId) return;

    const currentStageId = kanbanData?.stages
      .find((s) => s.deals.some((d) => d.id === draggingDealId))?.id;
    if (currentStageId === targetStageId) { setDraggingDealId(null); return; }

    try {
      await api.post(`/api/deals/${draggingDealId}/stage`, { stageId: targetStageId });
      refreshKanban();
    } catch (err: any) {
      if (err.data?.error === 'validation_failed') {
        setStageTransitionModal({
          dealId: draggingDealId,
          targetStageId,
          missingFields: err.data.missingFields,
        });
      }
    } finally {
      setDraggingDealId(null);
    }
  }

  function applyView(view: SavedView) {
    setActiveViewId(view.id);
    setAllColumns(view.config.columns ?? DEFAULT_DEAL_COLUMNS);
    if (view.config.sort) setSortField(view.config.sort);
    if (view.config.sortDir) setSortDir(view.config.sortDir);
    if (view.config.viewMode) setViewMode(view.config.viewMode);
    if (view.config.filters) {
      const f = view.config.filters;
      setFilterStageId(f.stageId ?? '');
      setFilterOwnerUserId(f.ownerUserId ?? '');
      setCreatedFrom(f.createdFrom ?? '');
      setCreatedTo(f.createdTo ?? '');
      setPropFilters(f.propFilters ?? {});
    }
    setPage(1);
  }

  async function handleSaveView(isTeam: boolean) {
    if (!viewName.trim()) return;
    setSavingView(true);
    try {
      const view = await api.post('/api/saved-views', {
        name: viewName.trim(),
        objectType: 'deal',
        config: {
          columns: allColumns,
          sort: sortField,
          sortDir,
          viewMode,
          filters: {
            stageId: filterStageId,
            ownerUserId: filterOwnerUserId,
            createdFrom,
            createdTo,
            propFilters,
          },
        },
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

  function clearFilters() {
    setFilterStageId('');
    setFilterOwnerUserId('');
    setCreatedFrom('');
    setCreatedTo('');
    setPropFilters({});
    setPage(1);
  }

  const activeFilterCount = [
    filterStageId ? 1 : 0,
    filterOwnerUserId ? 1 : 0,
    createdFrom || createdTo ? 1 : 0,
    ...Object.values(propFilters).map((v) => (v ? 1 : 0)),
  ].reduce((a, b) => a + b, 0);

  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    return new Intl.DateTimeFormat('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s));
  };

  const dealName = (d: { primaryContact: PrimaryContact | null }) => {
    if (!d.primaryContact) return 'Sense contacte';
    const { firstName, lastName, phoneE164 } = d.primaryContact;
    return [firstName, lastName].filter(Boolean).join(' ') || phoneE164 || 'Sense nom';
  };

  const currentPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  const dealPropDefs = propertyDefs.filter(
    (d) => d.scope === 'deal' || d.scope === 'both',
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: '0 0 auto' }}>Deals</h1>

        {/* Pipeline picker */}
        {pipelines.length > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedPipelineId(p.id); setPage(1); setFilterStageId(''); setViewMode(p.defaultView ?? 'list'); }}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  background: selectedPipelineId === p.id ? 'var(--color-primary)' : '#fff',
                  color: selectedPipelineId === p.id ? '#fff' : '#555',
                  fontWeight: selectedPipelineId === p.id ? 600 : 400,
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* View toggle */}
        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['list', 'kanban'] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: viewMode === m ? 'var(--color-primary)' : '#fff',
                color: viewMode === m ? '#fff' : '#666',
              }}
            >
              {m === 'list' ? 'Llista' : 'Kanban'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: 'var(--color-primary)', color: '#fff', border: 'none',
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + Nou deal
        </button>
      </div>

      {/* Toolbar */}
      <div
        style={{
          padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
          background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Cerca per nom, telèfon..."
          style={{
            padding: '7px 12px', border: '1px solid var(--color-border)',
            borderRadius: 6, fontSize: 13, width: 260, fontFamily: 'inherit', outline: 'none',
          }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666', cursor: 'pointer' }}>
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
            background: activeFilterCount > 0 ? '#eef2ff' : '#fff',
            borderColor: activeFilterCount > 0 ? 'var(--color-primary)' : 'var(--color-border)',
            color: activeFilterCount > 0 ? 'var(--color-primary)' : '#555',
            border: '1px solid',
            padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} ▾
        </button>

        {viewMode === 'list' && (
          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <button
              onClick={() => setShowColumnPicker((v) => !v)}
              style={{
                background: '#fff', border: '1px solid var(--color-border)',
                padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555',
              }}
            >
              Columnes ({allColumns.length})
            </button>
            {showColumnPicker && (
              <div
                style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff',
                  border: '1px solid var(--color-border)', borderRadius: 8, zIndex: 20,
                  padding: '8px 0', minWidth: 220, boxShadow: 'var(--shadow-md)',
                }}
              >
                {dealPropDefs.map((def) => (
                  <label
                    key={def.key}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={propColumns.includes(def.key)}
                      onChange={(e) => {
                        const key = def.key;
                        setAllColumns((prev) => {
                          if (e.target.checked) {
                            if (prev.includes(key)) return prev;
                            const creatIdx = prev.indexOf('_creat');
                            const ins = creatIdx >= 0 ? creatIdx : prev.length;
                            return [...prev.slice(0, ins), key, ...prev.slice(ins)];
                          }
                          return prev.filter((k) => k !== key);
                        });
                      }}
                    />
                    {def.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save view button */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowSaveView((v) => !v)}
            style={{
              background: '#fff', border: '1px solid var(--color-border)',
              padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555',
            }}
          >
            Guardar vista
          </button>
          {showSaveView && (
            <div
              style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff',
                border: '1px solid var(--color-border)', borderRadius: 8, zIndex: 20,
                padding: 12, minWidth: 240, boxShadow: 'var(--shadow-md)',
              }}
            >
              <input
                autoFocus
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="Nom de la vista..."
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleSaveView(false)}
                  disabled={savingView || !viewName.trim()}
                  style={{ flex: 1, background: 'var(--color-primary)', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
                >
                  Personal
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={() => handleSaveView(true)}
                    disabled={savingView || !viewName.trim()}
                    style={{ flex: 1, background: '#6c757d', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
                  >
                    Equip
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
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
            onClick={() => { setActiveViewId(null); setAllColumns(DEFAULT_DEAL_COLUMNS); setSortField('created_at'); setSortDir('desc'); setPage(1); }}
            style={{ padding: '6px 12px', borderRadius: '6px 6px 0 0', fontSize: 12, cursor: 'pointer', border: 'none', background: activeViewId === null ? 'var(--color-primary)' : 'transparent', color: activeViewId === null ? '#fff' : '#666', fontWeight: activeViewId === null ? 600 : 400 }}
          >
            Tots
          </button>
          {savedViews.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => applyView(v)}
                style={{ padding: '6px 12px', borderRadius: '6px 6px 0 0', fontSize: 12, cursor: 'pointer', border: 'none', background: activeViewId === v.id ? 'var(--color-primary)' : 'transparent', color: activeViewId === v.id ? '#fff' : '#666', fontWeight: activeViewId === v.id ? 600 : 400 }}
              >
                {v.isTeam ? '👥 ' : ''}{v.name}
              </button>
              {(v.createdByUserId === user?.id || (v.isTeam && user?.role === 'admin')) && (
                <button
                  onClick={() => handleDeleteView(v.id)}
                  title="Eliminar vista"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 12, padding: '0 4px' }}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      {showFilterBar && (
        <div
          style={{
            padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
            background: '#f9f9fb', display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          {/* Date range — full-width row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data creació</span>
            <input
              type="date"
              value={createdFrom}
              onChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }}
              style={inputStyle}
            />
            <span style={{ fontSize: 12, color: '#888' }}>–</span>
            <input
              type="date"
              value={createdTo}
              onChange={(e) => { setCreatedTo(e.target.value); setPage(1); }}
              style={inputStyle}
            />
          </div>

          {/* Stage, owner, and property filters — grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 16px', alignItems: 'end' }}>
            {/* Stage filter — only in list mode (kanban columns are already per-stage) */}
            {viewMode === 'list' && currentPipeline && currentPipeline.stages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Etapa</label>
                <select
                  value={filterStageId}
                  onChange={(e) => { setFilterStageId(e.target.value); setPage(1); }}
                  style={selectStyle}
                >
                  <option value="">Totes les etapes</option>
                  {currentPipeline.stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Owner filter */}
            {users.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Responsable</label>
                <select
                  value={filterOwnerUserId}
                  onChange={(e) => { setFilterOwnerUserId(e.target.value); setPage(1); }}
                  style={selectStyle}
                >
                  <option value="">Tots els responsables</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Property filters */}
            {dealPropDefs.map((def) => (
              <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{def.label}</label>
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
                    style={selectStyle}
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
                    style={inputStyle}
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
                    style={inputStyle}
                  />
                )}
              </div>
            ))}
          </div>

          {activeFilterCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={clearFilters}
                style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer', color: '#e74c3c', borderColor: '#e74c3c', background: '#fff', border: '1px solid', borderRadius: 5 }}
              >
                Esborrar filtres
              </button>
            </div>
          )}
        </div>
      )}

      {stageTransitionModal && (
        <StageFillModal
          dealId={stageTransitionModal.dealId}
          targetStageId={stageTransitionModal.targetStageId}
          missingFields={stageTransitionModal.missingFields}
          propertyDefs={dealPropDefs}
          users={users}
          onClose={() => setStageTransitionModal(null)}
          onSuccess={() => { setStageTransitionModal(null); refreshKanban(); }}
        />
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'list' ? (
          <ListView
            deals={deals}
            loading={loading}
            error={error}
            total={total}
            page={page}
            pageSize={pageSize}
            allColumns={allColumns}
            setAllColumns={setAllColumns}
            propertyDefs={propertyDefs}
            sortField={sortField}
            sortDir={sortDir}
            onSort={(field) => {
              if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
              else { setSortField(field); setSortDir('desc'); }
              setPage(1);
            }}
            onPageChange={setPage}
            onDealClick={(id) => navigate(`/deals/${id}`)}
            fmtDate={fmtDate}
            dealName={dealName}
          />
        ) : (
          <KanbanView
            kanbanData={kanbanData}
            loading={kanbanLoading}
            draggingDealId={draggingDealId}
            dragOverStageId={dragOverStageId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDealClick={(id) => navigate(`/deals/${id}`)}
            fmtDate={fmtDate}
            dealName={dealName}
          />
        )}
      </div>

      {showCreate && (
        <DealCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(dealId) => {
            setShowCreate(false);
            navigate(`/deals/${dealId}`);
          }}
        />
      )}

      {/* Close popovers on outside click */}
      {(showColumnPicker || showSaveView) && (
        <div
          onClick={() => { setShowColumnPicker(false); setShowSaveView(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 19 }}
        />
      )}
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({
  deals, loading, error, total, page, pageSize, allColumns, setAllColumns, propertyDefs,
  sortField, sortDir, onSort,
  onPageChange, onDealClick, fmtDate, dealName,
}: {
  deals: Deal[];
  loading: boolean;
  error: string;
  total: number;
  page: number;
  pageSize: number;
  allColumns: string[];
  setAllColumns: React.Dispatch<React.SetStateAction<string[]>>;
  propertyDefs: PropertyDef[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  onPageChange: (p: number) => void;
  onDealClick: (id: string) => void;
  fmtDate: (s: string | null) => string;
  dealName: (d: { primaryContact: PrimaryContact | null }) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const defFor = (key: string) => propertyDefs.find((d) => d.key === key);
  const propColumns = allColumns.filter((k) => !DEAL_FIXED_KEYS.has(k));

  // Column drag state (refs, no re-render needed)
  const dragColRef = useRef<string | null>(null);

  if (loading) return <div style={{ padding: 48, color: '#999', textAlign: 'center' }}>Carregant...</div>;
  if (error) return <div style={{ padding: 48, color: 'var(--color-error)', textAlign: 'center' }}>{error}</div>;

  return (
    <div style={{ padding: '0 24px 24px' }}>
      <div style={{ marginTop: 16, background: '#fff', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--color-border)' }}>
              {allColumns.map((key) => {
                const fixed = DEAL_FIXED_COLS.find((c) => c.key === key);
                return (
                  <ColTh
                    key={key}
                    colKey={key}
                    label={fixed ? fixed.label : (defFor(key)?.label ?? key)}
                    sortField={fixed?.sortField}
                    activeSortField={sortField}
                    sortDir={sortDir}
                    onSort={onSort}
                    allColumns={allColumns}
                    setAllColumns={setAllColumns}
                    dragColRef={dragColRef}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} style={{ padding: '32px 16px', color: '#999', textAlign: 'center' }}>
                  Cap deal trobat.
                </td>
              </tr>
            ) : (
              deals.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onDealClick(d.id)}
                  style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer', opacity: d.archivedAt ? 0.5 : 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f9f9f9')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {allColumns.map((key) => {
                    if (key === '_contacte') return (
                      <td key={key} style={td}>
                        <span style={{ fontWeight: 500 }}>{dealName(d)}</span>
                        {d.isClosedWon && <span style={{ marginLeft: 6, fontSize: 11, color: '#27ae60', fontWeight: 600 }}>Won</span>}
                        {d.isClosedLost && <span style={{ marginLeft: 6, fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>Lost</span>}
                        {d.archivedAt && <span style={{ marginLeft: 6, fontSize: 10, background: '#eee', color: '#888', borderRadius: 3, padding: '1px 4px' }}>Arxivat</span>}
                      </td>
                    );
                    if (key === '_telefon') return <td key={key} style={{ ...td, color: '#666' }}>{d.primaryContact?.phoneE164 ?? '—'}</td>;
                    if (key === '_etapa') return (
                      <td key={key} style={td}>
                        <span style={{ color: '#888' }}>{d.pipelineName}</span>
                        <span style={{ color: '#ccc', margin: '0 4px' }}>·</span>
                        {d.stageName}
                      </td>
                    );
                    if (key === '_responsable') return <td key={key} style={{ ...td, color: '#666' }}>{d.ownerName ?? '—'}</td>;
                    if (key === '_creat') return <td key={key} style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDate(d.createdAt)}</td>;
                    return (
                      <td key={key} style={{ ...td, color: '#666' }}>
                        {d.properties[key] ? formatPropValue(key, d.properties[key], defFor(key)) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, fontSize: 13, color: '#666' }}>
          <span>{total} deals</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={pageBtn}>Anterior</button>
            <span style={{ padding: '5px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} style={pageBtn}>Següent</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────

function KanbanView({
  kanbanData, loading, draggingDealId, dragOverStageId,
  onDragStart, onDragOver, onDrop, onDealClick, fmtDate, dealName,
}: {
  kanbanData: { pipeline: Pipeline; stages: KanbanStage[] } | null;
  loading: boolean;
  draggingDealId: string | null;
  dragOverStageId: string | null;
  onDragStart: (dealId: string) => void;
  onDragOver: (e: React.DragEvent, stageId: string) => void;
  onDrop: (e: React.DragEvent, stageId: string) => void;
  onDealClick: (id: string) => void;
  fmtDate: (s: string | null) => string;
  dealName: (d: { primaryContact: PrimaryContact | null }) => string;
}) {
  if (loading) return <div style={{ padding: 48, color: '#999', textAlign: 'center' }}>Carregant kanban...</div>;
  if (!kanbanData) return <div style={{ padding: 48, color: '#999', textAlign: 'center' }}>Selecciona un pipeline.</div>;

  const { stages } = kanbanData;

  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: '16px 24px 24px',
        overflowX: 'auto', alignItems: 'flex-start', minHeight: '100%',
      }}
    >
      {stages.map((stage) => {
        const isOver = dragOverStageId === stage.id;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => onDragOver(e, stage.id)}
            onDrop={(e) => onDrop(e, stage.id)}
            style={{
              width: 260, minWidth: 260, background: isOver ? '#f0f7ff' : '#f5f5f3',
              borderRadius: 8, padding: '0 0 8px',
              border: isOver ? '2px dashed var(--color-primary)' : '2px solid transparent',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {/* Stage header */}
            <div
              style={{
                padding: '10px 14px 8px', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', position: 'sticky', top: 0,
                background: isOver ? '#f0f7ff' : '#f5f5f3', borderRadius: '8px 8px 0 0', zIndex: 1,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{stage.name}</div>
                {stage.isClosedWon && <div style={{ fontSize: 11, color: '#27ae60', fontWeight: 600 }}>Won</div>}
                {stage.isClosedLost && <div style={{ fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>Lost</div>}
              </div>
              <div
                style={{
                  background: '#ddd', color: '#555', borderRadius: 10,
                  padding: '2px 7px', fontSize: 11, fontWeight: 600,
                }}
              >
                {stage.deals.length}
              </div>
            </div>

            {/* Cards */}
            <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stage.deals.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={() => onDragStart(deal.id)}
                  onClick={() => onDealClick(deal.id)}
                  style={{
                    background: '#fff', borderRadius: 6, padding: '10px 12px',
                    border: '1px solid var(--color-border)', cursor: 'grab',
                    boxShadow: 'var(--shadow-sm)', opacity: deal.archivedAt ? 0.5 : 1,
                    transition: 'box-shadow 0.1s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{dealName(deal)}</div>
                  {deal.primaryContact?.phoneE164 && (
                    <div style={{ fontSize: 11, color: '#888' }}>{deal.primaryContact.phoneE164}</div>
                  )}
                  {deal.ownerName && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{deal.ownerName}</div>
                  )}
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 6 }}>{fmtDate(deal.createdAt)}</div>
                </div>
              ))}
              {stage.deals.length === 0 && (
                <div style={{ padding: '20px 8px', color: '#bbb', fontSize: 12, textAlign: 'center' }}>
                  Cap deal
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPropValue(key: string, val: string, def: PropertyDef | undefined) {
  if (!def || !val) return val || '—';
  if ((def.type === 'select' || def.type === 'multiselect') && def.options) {
    return def.options.find((o) => o.key === val)?.label ?? val;
  }
  return val;
}

const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
  color: '#555', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 14px', verticalAlign: 'middle',
};

const pageBtn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid var(--color-border)', borderRadius: 5,
  background: '#fff', cursor: 'pointer', fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

// ─── Stage Fill Modal ─────────────────────────────────────────────────────────

function StageFillModal({
  dealId,
  targetStageId,
  missingFields,
  propertyDefs,
  users,
  onClose,
  onSuccess,
}: {
  dealId: string;
  targetStageId: string;
  missingFields: string[];
  propertyDefs: PropertyDef[];
  users: UserOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const hasOwnerField = missingFields.includes('owner_user_id');
  const propKeys = missingFields.filter((k) => k !== 'owner_user_id');
  const relevantDefs = propKeys
    .map((key) => propertyDefs.find((d) => d.key === key))
    .filter((d): d is PropertyDef => Boolean(d));

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const unfilledLabels: string[] = [];
    if (hasOwnerField && !values['owner_user_id']) unfilledLabels.push('Responsable');
    for (const def of relevantDefs) {
      if (!values[def.key]) unfilledLabels.push(def.label);
    }
    if (unfilledLabels.length > 0) {
      setError(`Omple els camps obligatoris: ${unfilledLabels.join(', ')}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const patchBody: Record<string, any> = {};
      if (hasOwnerField) patchBody.ownerUserId = values['owner_user_id'];
      const propValues: Record<string, string> = {};
      for (const def of relevantDefs) propValues[def.key] = values[def.key] ?? '';
      if (Object.keys(propValues).length > 0) patchBody.properties = propValues;
      await api.patch(`/api/deals/${dealId}`, patchBody);
      await api.post(`/api/deals/${dealId}/stage`, { stageId: targetStageId });
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Error en guardar.');
    } finally {
      setSaving(false);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200,
  };
  const modalStyle: React.CSSProperties = {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    background: '#fff', borderRadius: 10, padding: 24, zIndex: 201,
    width: '90%', maxWidth: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    maxHeight: '90vh', overflowY: 'auto',
  };
  const fieldStyle: React.CSSProperties = { marginBottom: 14 };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
  };
  const inputCommon: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)',
    borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <>
      <div onClick={onClose} style={overlayStyle} />
      <div style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Camps obligatoris per canviar d&apos;etapa
          </h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999' }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Omple els camps següents per poder moure el deal a la nova etapa.
        </p>
        <form onSubmit={handleSubmit}>
          {hasOwnerField && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Responsable *</label>
              <select
                value={values['owner_user_id'] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, owner_user_id: e.target.value }))}
                style={inputCommon}
              >
                <option value="">Selecciona un responsable...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
                ))}
              </select>
            </div>
          )}
          {relevantDefs.map((def) => (
            <div key={def.key} style={fieldStyle}>
              <label style={labelStyle}>{def.label} *</label>
              <PropertyInput
                def={def}
                value={values[def.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [def.key]: v }))}
                inputStyle={inputCommon}
              />
            </div>
          ))}
          {error && (
            <div style={{ color: '#e74c3c', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#fff', color: '#555', border: '1px solid var(--color-border)',
                padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel·lar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {saving ? 'Guardant...' : 'Guardar i moure'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function PropertyInput({
  def,
  value,
  onChange,
  inputStyle: style,
}: {
  def: PropertyDef;
  value: string;
  onChange: (v: string) => void;
  inputStyle: React.CSSProperties;
}) {
  if (def.type === 'select' || def.type === 'multiselect') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
        <option value="">Selecciona...</option>
        {def.options?.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (def.type === 'boolean') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
        <option value="">Selecciona...</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (def.type === 'date' || def.type === 'datetime') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
      />
    );
  }
  if (def.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={style}
      />
    );
  }
  return (
    <input
      type={def.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style}
    />
  );
}

// ─── ColTh ────────────────────────────────────────────────────────────────────

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
        padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
        whiteSpace: 'nowrap', userSelect: 'none',
        cursor: sortField ? 'pointer' : 'grab',
        color: isActive ? 'var(--color-primary)' : '#555',
      }}
    >
      {label}
      {sortField ? (isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕') : ''}
    </th>
  );
}
