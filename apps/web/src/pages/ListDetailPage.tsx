import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import ListCriteriaBuilder from '../components/ListCriteriaBuilder.js';

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  objectType: 'contact' | 'deal';
  kind: 'static' | 'dynamic';
  criteria: Record<string, string> | null;
  isTeam: boolean;
  memberCount: number | null;
  archivedAt: string | null;
}

interface ContactMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneE164: string | null;
  createdAt: string;
}

interface DealMember {
  id: string;
  primaryContact: { firstName: string | null; lastName: string | null; phoneE164: string | null; email: string | null } | null;
  pipelineName: string | null;
  stageName: string | null;
  ownerName: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = { static: 'Estàtica', dynamic: 'Dinàmica' };
const KIND_COLOR: Record<string, string> = { static: '#2e7d32', dynamic: '#1565c0' };
const KIND_BG: Record<string, string> = { static: '#e8f5e9', dynamic: '#e3f2fd' };

function fullName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(' ') || '—';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Human-readable criteria chip label
function criteriaLabel(key: string, value: string): string {
  const m = key.match(/^filter\[(.+)\]$/);
  if (m) return `${m[1]}: ${value}`;
  if (key === 'q') return `Cerca: ${value}`;
  if (key === 'createdFrom') return `Des de: ${value}`;
  if (key === 'createdTo') return `Fins: ${value}`;
  if (key === 'includeArchived') return value === 'true' ? 'Inclou arxivats' : '';
  if (key === 'ownerUserId') return `Responsable: ${value}`;
  return `${key}: ${value}`;
}

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [list, setList] = useState<ListDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [members, setMembers] = useState<(ContactMember | DealMember)[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');

  const [showEdit, setShowEdit] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [viewFilters, setViewFilters] = useState<Record<string, string>>({});
  const [showViewFilters, setShowViewFilters] = useState(false);

  const searchRef = useRef(search);
  searchRef.current = search;

  const PAGE_SIZE = 50;

  function loadList() {
    setListLoading(true);
    api.get(`/api/lists/${id}`)
      .then((data) => { setList(data); setListError(''); })
      .catch(() => setListError('Error carregant la llista.'))
      .finally(() => setListLoading(false));
  }

  function loadMembers(currentList = list) {
    if (!currentList) return;
    setMembersLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('q', search);
    // Append view filters for static lists
    if (currentList.kind === 'static') {
      for (const [k, v] of Object.entries(viewFilters)) {
        if (v) params.set(k, v);
      }
    }
    api.get(`/api/lists/${id}/members?${params}`)
      .then((data) => { setMembers(data.data); setTotal(data.total); setMembersError(''); })
      .catch(() => setMembersError('Error carregant els membres.'))
      .finally(() => setMembersLoading(false));
  }

  useEffect(() => { loadList(); setViewFilters({}); setShowViewFilters(false); }, [id]);
  useEffect(() => { if (list) loadMembers(); }, [list, page, search, viewFilters]);

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { /* effect handles it */ }, 350);
  }

  async function handleRemoveMember(objectId: string) {
    if (!list) return;
    try {
      await api.delete(`/api/lists/${list.id}/members/${objectId}`);
      loadMembers();
      loadList();
    } catch {
      alert('Error eliminant el membre.');
    }
  }

  if (listLoading) return <div style={{ padding: 48, color: '#999', textAlign: 'center' }}>Carregant...</div>;
  if (listError || !list) return <div style={{ padding: 48, color: 'var(--color-error)', textAlign: 'center' }}>{listError || 'Llista no trobada.'}</div>;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const criteriaChips = list.kind === 'dynamic' && list.criteria
    ? Object.entries(list.criteria)
        .map(([k, v]) => ({ key: k, label: criteriaLabel(k, v) }))
        .filter((c) => c.label)
    : [];

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <button
              onClick={() => navigate('/lists')}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0 }}
            >
              ← Llistes
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{list.name}</h1>
            <span style={{ fontSize: 11, fontWeight: 600, color: KIND_COLOR[list.kind], background: KIND_BG[list.kind], borderRadius: 4, padding: '2px 7px' }}>
              {KIND_LABEL[list.kind]}
            </span>
            {list.memberCount !== null && (
              <span style={{ fontSize: 12, color: '#666' }}>{list.memberCount} membres</span>
            )}
          </div>
          {list.description && (
            <div style={{ fontSize: 13, color: '#777', marginTop: 6 }}>{list.description}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowEdit(true)}
            style={{ fontSize: 13, color: '#555', background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '7px 14px', cursor: 'pointer' }}
          >
            Editar
          </button>
          {list.kind === 'static' && (
            <button
              onClick={() => setShowAddMember(true)}
              style={{ fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 600 }}
            >
              + Afegir membre
            </button>
          )}
        </div>
      </div>

      {/* Dynamic criteria chips */}
      {criteriaChips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: '#888', marginRight: 4, alignSelf: 'center' }}>Criteris:</span>
          {criteriaChips.map((c) => (
            <span
              key={c.key}
              style={{ fontSize: 11, background: '#e3f2fd', color: '#1565c0', borderRadius: 12, padding: '3px 10px', fontWeight: 500 }}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Search + view filters */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {list.objectType === 'contact' && (
            <input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Cercar membres..."
              style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 260 }}
            />
          )}
          {list.kind === 'static' && (
            <button
              onClick={() => setShowViewFilters((v) => !v)}
              style={{
                fontSize: 12, fontWeight: 600,
                color: showViewFilters ? '#fff' : '#555',
                background: showViewFilters ? 'var(--color-primary)' : '#fff',
                border: '1px solid',
                borderColor: showViewFilters ? 'var(--color-primary)' : '#ddd',
                borderRadius: 6, padding: '7px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              Filtres
              {Object.keys(viewFilters).length > 0 && (
                <span style={{
                  background: showViewFilters ? 'rgba(255,255,255,0.3)' : 'var(--color-primary)',
                  color: '#fff', borderRadius: '50%', width: 18, height: 18,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                }}>
                  {Object.keys(viewFilters).length}
                </span>
              )}
            </button>
          )}
        </div>
        {list.kind === 'static' && showViewFilters && (
          <div style={{ marginTop: 10 }}>
            <ListCriteriaBuilder objectType={list.objectType} criteria={viewFilters} onChange={(c) => { setViewFilters(c); setPage(1); }} />
          </div>
        )}
      </div>

      {membersError && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{membersError}</div>}

      {/* Members table */}
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {list.objectType === 'contact' ? (
          <ContactMembersTable
            members={members as ContactMember[]}
            loading={membersLoading}
            isStatic={list.kind === 'static'}
            onRemove={handleRemoveMember}
          />
        ) : (
          <DealMembersTable
            members={members as DealMember[]}
            loading={membersLoading}
            isStatic={list.kind === 'static'}
            onRemove={handleRemoveMember}
          />
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center', alignItems: 'center' }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ padding: '5px 12px', border: '1px solid #ddd', borderRadius: 4, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1, background: '#fff', fontSize: 13 }}
          >
            ‹
          </button>
          <span style={{ fontSize: 12, color: '#666' }}>Pàgina {page} / {totalPages} ({total} membres)</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ padding: '5px 12px', border: '1px solid #ddd', borderRadius: 4, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, background: '#fff', fontSize: 13 }}
          >
            ›
          </button>
        </div>
      )}

      {showEdit && (
        <EditListModal
          list={list}
          onClose={() => setShowEdit(false)}
          onSuccess={() => { setShowEdit(false); loadList(); }}
        />
      )}

      {showAddMember && (
        <AddMemberModal
          list={list}
          onClose={() => setShowAddMember(false)}
          onSuccess={() => { setShowAddMember(false); loadList(); loadMembers(); }}
        />
      )}
    </div>
  );
}

// ─── Contact members table ────────────────────────────────────────────────────

function ContactMembersTable({
  members, loading, isStatic, onRemove,
}: {
  members: ContactMember[];
  loading: boolean;
  isStatic: boolean;
  onRemove: (id: string) => void;
}) {
  const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--color-border)' }}>
          <th style={th}>Nom</th>
          <th style={th}>Telèfon</th>
          <th style={th}>Email</th>
          <th style={th}>Creat</th>
          {isStatic && <th style={th}></th>}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={isStatic ? 5 : 4} style={{ padding: '24px', color: '#999', textAlign: 'center' }}>Carregant...</td></tr>
        ) : members.length === 0 ? (
          <tr><td colSpan={isStatic ? 5 : 4} style={{ padding: '24px', color: '#999', textAlign: 'center' }}>Cap membre.</td></tr>
        ) : members.map((m) => (
          <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <td style={{ ...td, fontWeight: 500 }}>{fullName(m.firstName, m.lastName)}</td>
            <td style={{ ...td, color: '#666' }}>{m.phoneE164 ?? '—'}</td>
            <td style={{ ...td, color: '#666' }}>{m.email ?? '—'}</td>
            <td style={{ ...td, color: '#888' }}>{fmtDate(m.createdAt)}</td>
            {isStatic && (
              <td style={td}>
                <button
                  onClick={() => onRemove(m.id)}
                  style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                  title="Eliminar de la llista"
                >
                  ×
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Deal members table ───────────────────────────────────────────────────────

function DealMembersTable({
  members, loading, isStatic, onRemove,
}: {
  members: DealMember[];
  loading: boolean;
  isStatic: boolean;
  onRemove: (id: string) => void;
}) {
  const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--color-border)' }}>
          <th style={th}>Contacte</th>
          <th style={th}>Pipeline · Etapa</th>
          <th style={th}>Responsable</th>
          <th style={th}>Creat</th>
          {isStatic && <th style={th}></th>}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={isStatic ? 5 : 4} style={{ padding: '24px', color: '#999', textAlign: 'center' }}>Carregant...</td></tr>
        ) : members.length === 0 ? (
          <tr><td colSpan={isStatic ? 5 : 4} style={{ padding: '24px', color: '#999', textAlign: 'center' }}>Cap membre.</td></tr>
        ) : members.map((m) => (
          <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <td style={{ ...td, fontWeight: 500 }}>
              {m.primaryContact ? fullName(m.primaryContact.firstName, m.primaryContact.lastName) : '—'}
            </td>
            <td style={td}>
              {m.pipelineName && <span style={{ color: '#888' }}>{m.pipelineName}</span>}
              {m.pipelineName && m.stageName && <span style={{ color: '#ccc', margin: '0 4px' }}>·</span>}
              {m.stageName ?? '—'}
            </td>
            <td style={{ ...td, color: '#666' }}>{m.ownerName ?? '—'}</td>
            <td style={{ ...td, color: '#888' }}>{fmtDate(m.createdAt)}</td>
            {isStatic && (
              <td style={td}>
                <button
                  onClick={() => onRemove(m.id)}
                  style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                  title="Eliminar de la llista"
                >
                  ×
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditListModal({
  list,
  onClose,
  onSuccess,
}: {
  list: ListDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? '');
  const [criteria, setCriteria] = useState<Record<string, string>>(list.criteria ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('El nom és obligatori.'); return; }
    setSaving(true);
    setError('');
    try {
      const criteriaPayload = list.kind === 'dynamic' && Object.keys(criteria).length > 0 ? criteria : null;
      await api.patch(`/api/lists/${list.id}`, { name: name.trim(), description: description.trim() || null, ...(list.kind === 'dynamic' ? { criteria: criteriaPayload } : {}) });
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Error en guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: '90%', maxWidth: list.kind === 'dynamic' ? 600 : 440, boxShadow: '0 8px 32px rgba(0,0,0,0.16)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>Editar llista</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>Nom *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, boxSizing: 'border-box' }}
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
            />
          </div>
          {list.kind === 'dynamic' && (
            <div style={{ marginBottom: 14 }}>
              <ListCriteriaBuilder objectType={list.objectType} criteria={criteria} onChange={setCriteria} />
            </div>
          )}
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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

// ─── Add member modal ─────────────────────────────────────────────────────────

function AddMemberModal({
  list,
  onClose,
  onSuccess,
}: {
  list: ListDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [modalFilters, setModalFilters] = useState<Record<string, string>>({});
  const [showModalFilters, setShowModalFilters] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalFiltersRef = useRef(modalFilters);
  modalFiltersRef.current = modalFilters;

  function doSearch(q: string, filters = modalFiltersRef.current) {
    if (!q.trim() && Object.keys(filters).length === 0) { setResults([]); return; }
    setSearching(true);
    const params = new URLSearchParams({ pageSize: '10' });
    if (q.trim()) params.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
    const base = list.objectType === 'contact' ? '/api/contacts' : '/api/deals';
    api.get(`${base}?${params}`)
      .then((data) => setResults(data.data ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 350);
  }

  function handleModalFilterChange(filters: Record<string, string>) {
    setModalFilters(filters);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(search, filters), 350);
  }

  async function handleAdd(objectId: string) {
    setAdding(objectId);
    setError('');
    try {
      await api.post(`/api/lists/${list.id}/members`, { objectId });
      onSuccess();
    } catch (err: any) {
      if (err.status === 409) {
        setError('Aquest element ja és membre de la llista.');
      } else {
        setError(err.message ?? 'Error afegint el membre.');
      }
    } finally {
      setAdding(null);
    }
  }

  function resultLabel(item: any): string {
    if (list.objectType === 'contact') {
      return fullName(item.firstName, item.lastName) + (item.email ? ` — ${item.email}` : '') + (item.phoneE164 ? ` · ${item.phoneE164}` : '');
    }
    const contact = item.primaryContact;
    const name = contact ? fullName(contact.firstName, contact.lastName) : '—';
    return `${name} · ${item.pipelineName ?? ''} · ${item.stageName ?? ''}`;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: '90%', maxWidth: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.16)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>Afegir membre</h2>
        <input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={list.objectType === 'contact' ? 'Cercar per nom, email, telèfon...' : 'Cercar deal...'}
          style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, marginBottom: 8 }}
          autoFocus
        />
        <button
          onClick={() => setShowModalFilters((v) => !v)}
          style={{
            fontSize: 11, fontWeight: 600, color: showModalFilters ? 'var(--color-primary)' : '#777',
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginBottom: 8,
          }}
        >
          {showModalFilters ? '▾ Amagar filtres' : '▸ Filtres avançats'}
          {Object.keys(modalFilters).length > 0 && ` (${Object.keys(modalFilters).length})`}
        </button>
        {showModalFilters && (
          <div style={{ marginBottom: 10 }}>
            <ListCriteriaBuilder objectType={list.objectType} criteria={modalFilters} onChange={handleModalFilterChange} />
          </div>
        )}
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 60 }}>
          {searching && <div style={{ padding: '12px 0', color: '#999', fontSize: 13 }}>Cercant...</div>}
          {!searching && search && results.length === 0 && (
            <div style={{ padding: '12px 0', color: '#999', fontSize: 13 }}>Cap resultat.</div>
          )}
          {results.map((item) => (
            <div
              key={item.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
            >
              <span style={{ fontSize: 13, color: '#333' }}>{resultLabel(item)}</span>
              <button
                onClick={() => handleAdd(item.id)}
                disabled={adding === item.id}
                style={{ fontSize: 12, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: adding ? 'default' : 'pointer', opacity: adding === item.id ? 0.6 : 1, whiteSpace: 'nowrap' }}
              >
                {adding === item.id ? '...' : '+ Afegir'}
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', border: '1px solid #ddd', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
            Tancar
          </button>
        </div>
      </div>
    </div>
  );
}
