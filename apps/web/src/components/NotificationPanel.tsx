import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import type { Notification } from '../hooks/useNotificationStream.js';
import NotificationCard from './NotificationCard.js';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function sortNotifications(items: Notification[]): Notification[] {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  onRefetch: () => void;
}

type Tab = 'unread' | 'all';

export default function NotificationPanel({ open, onClose, notifications, onRefetch }: Props) {
  const [tab, setTab] = useState<Tab>('unread');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid immediate close from the bell click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  // Reset dismissed/read state when panel opens and refetch fresh data
  useEffect(() => {
    if (open) {
      setDismissed(new Set());
      setReadIds(new Set());
      onRefetch();
    }
  }, [open, onRefetch]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const handleRead = useCallback((id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
  }, []);

  async function handleMarkAllRead() {
    try {
      await api.patch('/api/notifications/read-all');
      onRefetch();
    } catch {
      // Non-fatal
    }
  }

  const visibleNotifications = notifications
    .filter((n) => !dismissed.has(n.id) && !n.dismissed_at)
    .map((n) => (readIds.has(n.id) ? { ...n, read_at: new Date().toISOString() } : n));

  const filtered =
    tab === 'unread'
      ? visibleNotifications.filter((n) => !n.read_at)
      : visibleNotifications;

  const sorted = sortNotifications(filtered);

  if (!open) return null;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
    cursor: 'pointer',
  });

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 380,
        maxWidth: '100vw',
        height: '100vh',
        background: 'var(--color-surface)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 16px 0',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
            Notificacions
          </span>
          <button
            onClick={handleMarkAllRead}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Marcar tot com a llegit
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setTab('unread')} style={tabStyle(tab === 'unread')}>
            No llegides
          </button>
          <button onClick={() => setTab('all')} style={tabStyle(tab === 'all')}>
            Totes
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-muted)',
            }}
          >
            <span style={{ fontSize: 32, marginBottom: 12 }}>✓</span>
            <span style={{ fontSize: 14 }}>Estàs al dia</span>
          </div>
        ) : (
          sorted.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onDismiss={handleDismiss}
              onRead={handleRead}
              onClose={onClose}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
        }}
      >
        <button
          onClick={() => {
            onClose();
            navigate('/notifications');
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-primary)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Veure totes les notificacions
        </button>
      </div>
    </div>
  );
}
