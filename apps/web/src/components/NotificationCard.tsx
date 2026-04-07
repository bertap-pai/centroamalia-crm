import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import type { Notification } from '../hooks/useNotificationStream.js';
import { getNotificationIcon, relativeTime, getDeepLinkUrl } from '../lib/notification-utils.js';

interface Props {
  notification: Notification;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
}

export default function NotificationCard({ notification, onDismiss, onRead }: Props) {
  const navigate = useNavigate();
  const isUnread = !notification.read_at;
  const icon = getNotificationIcon(notification.type, notification.priority);
  const deepLink = getDeepLinkUrl(notification.entity_type, notification.entity_id);
  const timeLabel = relativeTime(notification.created_at);
  const fullDate = new Date(notification.created_at).toISOString();
  const truncatedTitle =
    notification.title.length > 80
      ? notification.title.slice(0, 80) + '…'
      : notification.title;

  async function handleClick() {
    if (isUnread) {
      try {
        await api.patch(`/api/notifications/${notification.id}/read`);
        onRead(notification.id);
      } catch {
        // Non-fatal
      }
    }
    navigate(deepLink);
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.patch(`/api/notifications/${notification.id}/dismiss`);
      onDismiss(notification.id);
    } catch {
      // Non-fatal
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        cursor: 'pointer',
        background: isUnread ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
        borderBottom: '1px solid var(--color-border)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isUnread
          ? 'rgba(37, 99, 235, 0.1)'
          : 'rgba(0,0,0,0.03)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isUnread
          ? 'rgba(37, 99, 235, 0.06)'
          : 'transparent';
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 2 }}>{icon}</span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: isUnread ? 600 : 400,
            color: 'var(--color-text)',
            lineHeight: 1.3,
          }}
        >
          {truncatedTitle}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          title={fullDate}
          style={{ fontSize: 11, color: '#999', marginTop: 3 }}
        >
          {timeLabel}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        title="Descartar"
        style={{
          background: 'none',
          border: 'none',
          color: '#999',
          fontSize: 16,
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
