import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useNotificationStream, type Notification } from '../hooks/useNotificationStream.js';
import {
  getNotificationIcon,
  getNotificationBadgeClass,
  relativeTime,
  getDeepLinkUrl,
} from '../lib/notification-utils.js';

const PAGE_SIZE = 50;

const NOTIFICATION_TYPES = [
  { value: '', label: 'Tots els tipus' },
  { value: 'workflow_run_failed', label: 'Workflow fallit' },
  { value: 'workflow_engine_error', label: 'Error de motor' },
  { value: 'task_assigned', label: 'Tasca assignada' },
  { value: 'task_due_soon', label: 'Tasca propera' },
  { value: 'task_overdue', label: 'Tasca vençuda' },
  { value: 'deal_stage_changed', label: 'Canvi de deal' },
  { value: 'contact_assigned', label: 'Contacte assignat' },
  { value: 'system_alert', label: 'Alerta del sistema' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'Totes les prioritats' },
  { value: 'critical', label: 'Crítica' },
  { value: 'high', label: 'Alta' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Baixa' },
];

const READ_OPTIONS = [
  { value: '', label: 'Totes' },
  { value: 'unread', label: 'No llegides' },
  { value: 'read', label: 'Llegides' },
];

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { refetch: refetchStream } = useNotificationStream();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [readFilter, setReadFilter] = useState('');

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      if (typeFilter) params.set('type', typeFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (readFilter === 'unread') params.set('unread', 'true');
      if (readFilter === 'read') params.set('unread', 'false');

      const result = await api.get(`/api/notifications?${params.toString()}`);
      const data = result.data ?? result;
      if (Array.isArray(data)) {
        setItems(data);
        setTotal(data.length >= PAGE_SIZE ? (page * PAGE_SIZE) + 1 : ((page - 1) * PAGE_SIZE) + data.length);
      } else {
        setItems(data.data ?? []);
        setTotal(data.total ?? data.data?.length ?? 0);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, priorityFilter, readFilter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [typeFilter, priorityFilter, readFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((n) => n.id)));
    }
  }

  async function bulkMarkRead() {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => api.patch(`/api/notifications/${id}/read`).catch(() => {})));
    setSelected(new Set());
    fetchNotifications();
    refetchStream();
  }

  async function bulkDismiss() {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => api.patch(`/api/notifications/${id}/dismiss`).catch(() => {})));
    setSelected(new Set());
    fetchNotifications();
    refetchStream();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--color-border)',
    fontSize: 12,
    background: '#fff',
    color: 'var(--color-text)',
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: 'var(--color-text)' }}>
        Notificacions
      </h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={selectStyle}
        >
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          style={selectStyle}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <select
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value)}
          style={selectStyle}
        >
          {READ_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(232, 125, 82, 0.08)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {selected.size} seleccionades
          </span>
          <button onClick={bulkMarkRead} style={actionBtnStyle}>
            Marcar com a llegides
          </button>
          <button onClick={bulkDismiss} style={actionBtnStyle}>
            Descartar
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: 24, color: '#999' }}>Carregant...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>✓</span>
          Cap notificació
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>
                <input
                  type="checkbox"
                  checked={selected.size === items.length && items.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th style={thStyle}></th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Títol</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Tipus</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Prioritat</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Data</th>
              <th style={thStyle}>Estat</th>
              <th style={thStyle}>Accions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => {
              const isUnread = !n.read_at;
              const icon = getNotificationIcon(n.type, n.priority);
              const badgeStyle = getNotificationBadgeClass(n.priority);
              const deepLink = getDeepLinkUrl(n.entity_type, n.entity_id);

              return (
                <tr
                  key={n.id}
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    background: isUnread ? 'rgba(37, 99, 235, 0.04)' : 'transparent',
                  }}
                >
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={selected.has(n.id)}
                      onChange={() => toggleSelect(n.id)}
                    />
                  </td>
                  <td style={{ ...tdStyle, fontSize: 16 }}>{icon}</td>
                  <td style={tdStyle}>
                    <a
                      href={deepLink}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isUnread) api.patch(`/api/notifications/${n.id}/read`).catch(() => {});
                        navigate(deepLink);
                      }}
                      style={{
                        color: 'var(--color-text)',
                        textDecoration: 'none',
                        fontWeight: isUnread ? 600 : 400,
                      }}
                    >
                      {n.title}
                    </a>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {n.type.replace(/_/g, ' ')}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        ...badgeStyle,
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                      }}
                    >
                      {n.priority}
                    </span>
                  </td>
                  <td style={tdStyle} title={new Date(n.created_at).toISOString()}>
                    {relativeTime(n.created_at)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isUnread ? '#2563eb' : '#d1d5db',
                      }}
                      title={isUnread ? 'No llegida' : 'Llegida'}
                    />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      onClick={async () => {
                        await api.patch(`/api/notifications/${n.id}/dismiss`).catch(() => {});
                        fetchNotifications();
                        refetchStream();
                      }}
                      title="Descartar"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#999',
                        fontSize: 16,
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={pageBtnStyle(page <= 1)}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '6px 0' }}>
            Pàgina {page}
          </span>
          <button
            disabled={items.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            style={pageBtnStyle(items.length < PAGE_SIZE)}
          >
            Següent →
          </button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--color-text-muted)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'middle',
};

const actionBtnStyle: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  padding: '4px 12px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid var(--color-border)',
    background: disabled ? '#f5f5f5' : '#fff',
    color: disabled ? '#ccc' : 'var(--color-text)',
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
