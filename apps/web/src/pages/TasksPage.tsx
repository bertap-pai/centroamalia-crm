import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

interface TaskRow {
  id: string;
  objectType: 'contact' | 'deal';
  objectId: string;
  objectName: string | null;
  title: string;
  dueAt: string | null;
  status: 'open' | 'done';
  assigneeName: string | null;
  createdAt: string;
}

interface UserOption {
  id: string;
  name: string | null;
}

type SortBy = 'created_at' | 'due_at' | 'title';
type SortDir = 'asc' | 'desc';
type View = 'card' | 'list';

const ALL_COLUMNS = [
  { key: 'title', label: 'Tasca', sortable: true },
  { key: 'due_at', label: 'Venciment', sortable: true },
  { key: 'status', label: 'Estat', sortable: false },
  { key: 'assignee', label: 'Assignat a', sortable: false },
  { key: 'object', label: 'Contacte / Deal', sortable: false },
  { key: 'created_at', label: 'Creat', sortable: true },
] as const;

const DEFAULT_COLUMNS = ['title', 'due_at', 'status', 'assignee', 'object'];

function loadSavedColumns(): string[] {
  try {
    const saved = localStorage.getItem('tasks_list_columns');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

const fmtDate = (s: string | null) => {
  if (!s) return '';
  return new Intl.DateTimeFormat('ca-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(s));
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [updating, setUpdating] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Advanced filters
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterObjectType, setFilterObjectType] = useState('');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo] = useState('');

  // Sort & view
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [view, setView] = useState<View>('card');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadSavedColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/api/users').then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showColumnPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showColumnPicker]);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (filterAssignee) params.set('assignedToUserId', filterAssignee);
    if (filterObjectType) params.set('objectType', filterObjectType);
    if (dueDateFrom) params.set('dueDateFrom', dueDateFrom);
    if (dueDateTo) params.set('dueDateTo', dueDateTo);
    params.set('sortBy', sortBy);
    params.set('sortDir', sortDir);
    api.get(`/api/tasks?${params}`)
      .then((rows: TaskRow[]) => setTasks(rows))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filter, filterAssignee, filterObjectType, dueDateFrom, dueDateTo, sortBy, sortDir]);

  async function toggleStatus(task: TaskRow) {
    if (updating) return;
    setUpdating(task.id);
    const newStatus = task.status === 'open' ? 'done' : 'open';
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: newStatus });
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: newStatus } : t));
    } finally {
      setUpdating(null);
    }
  }

  const objectLink = (task: TaskRow) => {
    const name = task.objectName ?? task.objectId.slice(0, 8);
    const to = task.objectType === 'contact' ? `/contacts/${task.objectId}` : `/deals/${task.objectId}`;
    return <Link to={to} style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>{name}</Link>;
  };

  const isOverdue = (task: TaskRow) =>
    task.status === 'open' && task.dueAt && new Date(task.dueAt) < new Date();

  const activeFilterCount = [
    filterAssignee ? 1 : 0,
    filterObjectType ? 1 : 0,
    dueDateFrom || dueDateTo ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  function clearFilters() {
    setFilterAssignee('');
    setFilterObjectType('');
    setDueDateFrom('');
    setDueDateTo('');
  }

  function toggleColumn(key: string) {
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((c) => c !== key)
      : [...visibleColumns, key];
    setVisibleColumns(next);
    localStorage.setItem('tasks_list_columns', JSON.stringify(next));
  }

  function handleSortColumn(key: string) {
    const col = ALL_COLUMNS.find((c) => c.key === key);
    if (!col?.sortable) return;
    const newSortBy = key as SortBy;
    if (sortBy === newSortBy) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortDir(newSortBy === 'title' ? 'asc' : 'desc');
    }
  }

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: 'due_at', label: 'Venciment' },
    { value: 'title', label: 'Nom' },
    { value: 'created_at', label: 'Creat' },
  ];

  const shownColumns = ALL_COLUMNS.filter((c) => visibleColumns.includes(c.key));

  const rowOverdueStyle = (task: TaskRow): React.CSSProperties => isOverdue(task)
    ? { background: '#fff5f5', borderLeft: '3px solid #e74c3c' }
    : { background: '#fff', borderLeft: '3px solid transparent' };

  const checkboxBtn = (task: TaskRow) => (
    <button
      onClick={() => toggleStatus(task)}
      disabled={updating === task.id}
      title={task.status === 'open' ? 'Marcar com a feta' : 'Reobrir'}
      style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: '2px solid', cursor: 'pointer',
        borderColor: task.status === 'done' ? 'var(--color-primary)' : '#ccc',
        background: task.status === 'done' ? 'var(--color-primary)' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 11, fontWeight: 700,
      }}
    >
      {task.status === 'done' ? '✓' : ''}
    </button>
  );

  const dueDateCell = (task: TaskRow) => task.dueAt ? (
    <span style={{ color: isOverdue(task) ? '#e74c3c' : '#888', fontWeight: isOverdue(task) ? 600 : 400 }}>
      {isOverdue(task) ? '⚠ ' : ''}Venciment: {fmtDate(task.dueAt)}
    </span>
  ) : (
    <span style={{ color: '#bbb' }}>Sense venciment</span>
  );

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Tasques</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status tabs */}
          {(['open', 'done', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                fontFamily: 'inherit', border: '1px solid var(--color-border)',
                background: filter === f ? 'var(--color-primary)' : '#fff',
                color: filter === f ? '#fff' : '#555',
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f === 'open' ? 'Obertes' : f === 'done' ? 'Fetes' : 'Totes'}
            </button>
          ))}

          <span style={{ color: '#ddd' }}>|</span>

          {/* Sort controls */}
          <select
            value={sortBy}
            onChange={(e) => {
              const v = e.target.value as SortBy;
              setSortBy(v);
              setSortDir(v === 'title' ? 'asc' : 'desc');
            }}
            style={{ ...selectStyle, width: 'auto', fontSize: 12 }}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascendent' : 'Descendent'}
            style={{ padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--color-border)', background: '#fff', color: '#555' }}
          >
            {sortDir === 'asc' ? '▲' : '▼'}
          </button>

          <span style={{ color: '#ddd' }}>|</span>

          {/* View toggle */}
          {(['card', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={v === 'card' ? 'Vista de targetes' : 'Vista de llista'}
              style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                fontFamily: 'inherit', border: '1px solid var(--color-border)',
                background: view === v ? 'var(--color-primary)' : '#fff',
                color: view === v ? '#fff' : '#555',
              }}
            >
              {v === 'card' ? '⊟' : '☰'}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          marginBottom: 16, padding: '16px 20px', background: '#f9f9fb',
          border: '1px solid var(--color-border)', borderRadius: 8,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '10px 16px', alignItems: 'end',
        }}
      >
        {users.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Assignat a</span>
            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} style={selectStyle}>
              <option value="">Tots</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Tipus</span>
          <select value={filterObjectType} onChange={(e) => setFilterObjectType(e.target.value)} style={selectStyle}>
            <option value="">Tots</option>
            <option value="contact">Contacte</option>
            <option value="deal">Deal</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Venciment des de</span>
          <input type="date" value={dueDateFrom} onChange={(e) => setDueDateFrom(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Venciment fins a</span>
          <input type="date" value={dueDateTo} onChange={(e) => setDueDateTo(e.target.value)} style={inputStyle} />
        </div>

        {activeFilterCount > 0 && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={clearFilters}
              style={{ fontSize: 12, padding: '6px 10px', cursor: 'pointer', color: '#e74c3c', border: '1px solid #e74c3c', background: '#fff', borderRadius: 5 }}
            >
              Esborrar filtres
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#999', fontSize: 13 }}>Carregant...</div>
      ) : tasks.length === 0 ? (
        <div style={{ color: '#999', fontSize: 13 }}>Cap tasca trobada.</div>
      ) : view === 'card' ? (
        // ─── Card view ───────────────────────────────────────────────────────────
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          {tasks.map((task, i) => (
            <div
              key={task.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: i < tasks.length - 1 ? '1px solid #f3f3f3' : 'none',
                opacity: task.status === 'done' ? 0.55 : 1,
                ...rowOverdueStyle(task),
              }}
            >
              <div style={{ marginTop: 1 }}>{checkboxBtn(task)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                  {task.title}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{task.objectType === 'contact' ? '👤' : '💼'} {objectLink(task)}</span>
                  {task.assigneeName && <span>Assignat a: {task.assigneeName}</span>}
                  {dueDateCell(task)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ─── List view ───────────────────────────────────────────────────────────
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }} ref={columnPickerRef}>
            <button
              onClick={() => setShowColumnPicker((v) => !v)}
              title="Seleccionar columnes"
              style={{ padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--color-border)', background: '#fff', color: '#555' }}
            >
              ⚙ Columnes
            </button>
            {showColumnPicker && (
              <div style={{
                position: 'absolute', top: 32, right: 0, zIndex: 100,
                background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8,
                padding: '10px 14px', minWidth: 180, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              }}>
                {ALL_COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9f9fb', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ width: 36, padding: '8px 10px' }} />
                  {shownColumns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSortColumn(col.key)}
                      style={{
                        padding: '8px 12px', textAlign: 'left', fontWeight: 600,
                        fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em',
                        cursor: col.sortable ? 'pointer' : 'default',
                        userSelect: 'none', whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}
                      {col.sortable && sortBy === col.key && (
                        <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr
                    key={task.id}
                    style={{
                      borderBottom: i < tasks.length - 1 ? '1px solid #f3f3f3' : 'none',
                      opacity: task.status === 'done' ? 0.55 : 1,
                      ...rowOverdueStyle(task),
                    }}
                  >
                    <td style={{ padding: '10px 10px', verticalAlign: 'middle' }}>
                      {checkboxBtn(task)}
                    </td>
                    {shownColumns.map((col) => (
                      <td key={col.key} style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        {col.key === 'title' && (
                          <span style={{ fontWeight: 500, textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                            {task.title}
                          </span>
                        )}
                        {col.key === 'due_at' && (
                          task.dueAt ? (
                            <span style={{ color: isOverdue(task) ? '#e74c3c' : '#555', fontWeight: isOverdue(task) ? 600 : 400 }}>
                              {isOverdue(task) ? '⚠ ' : ''}{fmtDate(task.dueAt)}
                            </span>
                          ) : (
                            <span style={{ color: '#bbb' }}>Sense venciment</span>
                          )
                        )}
                        {col.key === 'status' && (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11,
                            background: task.status === 'done' ? '#eafaf1' : '#fff3cd',
                            color: task.status === 'done' ? '#1e8449' : '#856404',
                            fontWeight: 500,
                          }}>
                            {task.status === 'done' ? 'Feta' : 'Oberta'}
                          </span>
                        )}
                        {col.key === 'assignee' && (
                          <span style={{ color: '#555' }}>{task.assigneeName ?? '—'}</span>
                        )}
                        {col.key === 'object' && (
                          <span>{task.objectType === 'contact' ? '👤' : '💼'} {objectLink(task)}</span>
                        )}
                        {col.key === 'created_at' && (
                          <span style={{ color: '#888' }}>{fmtDate(task.createdAt)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em',
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
};
