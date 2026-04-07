export function getNotificationBadgeClass(priority: string): React.CSSProperties {
  switch (priority) {
    case 'critical':
      return { background: '#dc2626', color: '#fff' };
    case 'high':
      return { background: '#ea580c', color: '#fff' };
    case 'normal':
      return { background: '#2563eb', color: '#fff' };
    case 'low':
      return { background: '#6b7280', color: '#fff' };
    default:
      return { background: '#6b7280', color: '#fff' };
  }
}

export function getNotificationIcon(type: string, priority: string): string {
  if (type === 'workflow_run_failed' || type === 'workflow_engine_error' || type === 'task_overdue') {
    return '⚠️';
  }
  if (type === 'system_alert' && priority === 'critical') {
    return '🚨';
  }
  if (type === 'deal_stage_changed' || type === 'task_assigned' || type === 'contact_assigned') {
    return 'ℹ️';
  }
  return 'ℹ️';
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'ara mateix';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `fa ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `fa ${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `fa ${diffDay}d`;
}

export function getDeepLinkUrl(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'contact':
      return `/contacts/${entityId}`;
    case 'task':
      return `/tasks/${entityId}`;
    case 'deal':
      return `/deals/${entityId}`;
    case 'workflow_run':
      return `/workflows/${entityId}`;
    case 'system':
      return '/settings/system-log';
    default:
      return '/';
  }
}
