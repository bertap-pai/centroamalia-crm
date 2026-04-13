import type { ServerResponse } from 'node:http';

/**
 * Singleton registry of active SSE connections keyed by userId.
 * Each user can have one active SSE connection at a time.
 */
const connections = new Map<string, ServerResponse>();

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepalive() {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    for (const [userId, res] of connections) {
      if (res.destroyed) {
        connections.delete(userId);
        continue;
      }
      res.write(': keepalive\n\n');
    }
  }, 30_000);
  keepaliveInterval.unref();
}

export const sseRegistry = {
  register(userId: string, res: ServerResponse): void {
    // Close any existing connection for this user
    const existing = connections.get(userId);
    if (existing && !existing.destroyed) {
      existing.end();
    }
    connections.set(userId, res);
    startKeepalive();
  },

  unregister(userId: string): void {
    connections.delete(userId);
  },

  push(userId: string, event: string, data: string): void {
    const res = connections.get(userId);
    if (!res || res.destroyed) {
      connections.delete(userId);
      return;
    }
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  },

  pushAll(event: string, data: string): void {
    for (const [userId, res] of connections) {
      if (res.destroyed) {
        connections.delete(userId);
        continue;
      }
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    }
  },

  has(userId: string): boolean {
    const res = connections.get(userId);
    if (res && res.destroyed) {
      connections.delete(userId);
      return false;
    }
    return connections.has(userId);
  },
};
