import { useEffect, useState } from 'react';
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

  useEffect(() => {
    api.get('/api/users').then(setUsers).catch(() => {});
  }, []);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (filterAssignee) params.set('assignedToUserId', filterAssignee);
    if (filterObjectType) params.set('objectType', filterObjectType);
    if (dueDateFrom) params.set('dueDateFrom', dueDateFrom);
    if (dueDateTo) params.set('dueDateTo', dueDateTo);
    api.get(`/api/tasks?${params}`)
      .then((rows: TaskRow[]) => setTasks(rows))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filter, filterAssignee, filterObjectType, dueDateFrom, dueDateTo]);

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

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Tasques</h1>
        <div style={{ display: 'flex', gap: 6 }}>
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
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          marginBottom: 16, padding: '12px 16px', background: '#f9f9fb',
          border: '1px solid var(--color-border)', borderRadius: 8,
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end',
        }}
      >
        {/* Assignee */}
        {users.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={labelStyle}>Assignat a</span>
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              style={selectStyle}
            >
              <option value="">Tots</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
              ))}
            </select>
          </div>
        )}

        {/* Object type */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={labelStyle}>Tipus</span>
          <select
            value={filterObjectType}
            onChange={(e) => setFilterObjectType(e.target.value)}
            style={selectStyle}
          >
            <option value="">Tots</option>
            <option value="contact">Contacte</option>
            <option value="deal">Deal</option>
          </select>
        </div>

        {/* Due date range */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={labelStyle}>Venciment des de</span>
          <input
            type="date"
            value={dueDateFrom}
            onChange={(e) => setDueDateFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={labelStyle}>Venciment fins a</span>
          <input
            type="date"
            value={dueDateTo}
            onChange={(e) => setDueDateTo(e.target.value)}
            style={inputStyle}
          />
        </div>

        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            style={{
              fontSize: 12, padding: '6px 10px', cursor: 'pointer',
              color: '#e74c3c', border: '1px solid #e74c3c', background: '#fff',
              borderRadius: 5, alignSelf: 'flex-end',
            }}
          >
            Esborrar filtres
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#999', fontSize: 13 }}>Carregant...</div>
      ) : tasks.length === 0 ? (
        <div style={{ color: '#999', fontSize: 13 }}>Cap tasca trobada.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          {tasks.map((task, i) => (
            <div
              key={task.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: i < tasks.length - 1 ? '1px solid #f3f3f3' : 'none',
                opacity: task.status === 'done' ? 0.55 : 1,
              }}
            >
              {/* Checkbox */}
              <button
                onClick={() => toggleStatus(task)}
                disabled={updating === task.id}
                title={task.status === 'open' ? 'Marcar com a feta' : 'Reobrir'}
                style={{
                  marginTop: 1, width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: '2px solid', cursor: 'pointer',
                  borderColor: task.status === 'done' ? 'var(--color-primary)' : '#ccc',
                  background: task.status === 'done' ? 'var(--color-primary)' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700,
                }}
              >
                {task.status === 'done' ? '✓' : ''}
              </button>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                  {task.title}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>
                    {task.objectType === 'contact' ? '👤' : '💼'} {objectLink(task)}
                  </span>
                  {task.assigneeName && <span>Assignat a: {task.assigneeName}</span>}
                  {task.dueAt && (
                    <span style={{ color: isOverdue(task) ? '#e74c3c' : '#888', fontWeight: isOverdue(task) ? 600 : 400 }}>
                      {isOverdue(task) ? '⚠ ' : ''}Venciment: {fmtDate(task.dueAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#888', fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', minWidth: 140,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none',
};
