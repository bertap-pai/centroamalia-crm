import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api.js';
import { BASE_PATH } from '../lib/base-path.js';

export interface Notification {
  id: string;
  type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  body: string | null;
  entity_type: string;
  entity_id: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  created_by: string;
}

interface SSENotificationPayload {
  id: string;
  type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  body: string | null;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

const MAX_RETRIES = 5;
const BACKOFF_CAP_MS = 30_000;
const POLL_INTERVAL_MS = 30_000;

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, BACKOFF_CAP_MS);
}

export function useNotificationStream(): {
  notifications: Notification[];
  unreadCount: number;
  criticalCount: number;
  refetch: () => void;
} {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);

  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const pollTimer = useRef<ReturnType<typeof setInterval>>();
  const eventSourceRef = useRef<EventSource | null>(null);
  const isFallback = useRef(false);

  const fetchInitial = useCallback(async () => {
    try {
      const result = await api.get('/api/notifications?unread=true&limit=50');
      const items: Notification[] = result.data ?? result;
      setNotifications(items);
      setUnreadCount(items.length);
      setCriticalCount(items.filter((n: Notification) => n.priority === 'critical').length);
    } catch {
      // Silently fail initial load — SSE will still work
    }
  }, []);

  const fetchCounts = useCallback(async () => {
    try {
      const counts = await api.get('/api/notifications/count');
      setUnreadCount(counts.unread);
      setCriticalCount(counts.critical);
    } catch {
      // Polling failure is non-fatal
    }
  }, []);

  const startPollingFallback = useCallback(() => {
    if (isFallback.current) return;
    isFallback.current = true;
    pollTimer.current = setInterval(fetchCounts, POLL_INTERVAL_MS);
  }, [fetchCounts]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${BASE_PATH}/api/notifications/stream`, {
      withCredentials: true,
    });
    eventSourceRef.current = es;

    es.addEventListener('notification_created', (e: MessageEvent) => {
      try {
        const payload: SSENotificationPayload = JSON.parse(e.data);
        const notification: Notification = {
          ...payload,
          read_at: null,
          dismissed_at: null,
          created_by: '',
        };
        setNotifications((prev) => [notification, ...prev]);
        setUnreadCount((prev) => prev + 1);
        if (payload.priority === 'critical') {
          setCriticalCount((prev) => prev + 1);
        }
      } catch {
        // Malformed event — skip
      }
    });

    es.onopen = () => {
      retryCount.current = 0;
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (retryCount.current < MAX_RETRIES) {
        const delay = backoffMs(retryCount.current);
        retryCount.current += 1;
        retryTimer.current = setTimeout(connectSSE, delay);
      } else {
        startPollingFallback();
      }
    };
  }, [startPollingFallback]);

  const refetch = useCallback(() => {
    fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    fetchInitial();
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
      }
    };
  }, [fetchInitial, connectSSE]);

  return { notifications, unreadCount, criticalCount, refetch };
}
