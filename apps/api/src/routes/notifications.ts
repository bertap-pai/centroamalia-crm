import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, isNotNull, count, sql, desc, lte } from 'drizzle-orm';
import { notifications } from '@crm/db';
import { createNotification, type CreateNotificationInput } from '../services/notifications.js';
import { sseRegistry } from '../lib/sse-registry.js';

export default async function notificationsRoutes(app: FastifyInstance) {
  // GET /api/notifications/stream — SSE endpoint for real-time notifications
  app.get('/api/notifications/stream', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.user!.id;
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    sseRegistry.register(userId, raw);

    req.raw.on('close', () => {
      sseRegistry.unregister(userId);
    });

    // Prevent Fastify from ending the response
    reply.hijack();
  });

  // GET /api/notifications — list notifications for the authenticated user
  app.get('/api/notifications', { preHandler: app.requireAuth }, async (req, reply) => {
    const query = req.query as {
      unread?: string;
      type?: string;
      priority?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(query.offset || '0', 10));
    const userId = req.user!.id;

    const conditions = [
      eq(notifications.userId, userId),
      isNull(notifications.dismissedAt),
    ];

    if (query.unread === 'true') {
      conditions.push(isNull(notifications.readAt));
    } else if (query.unread === 'false') {
      conditions.push(isNotNull(notifications.readAt));
    }
    if (query.type) {
      conditions.push(eq(notifications.type, query.type));
    }
    if (query.priority) {
      conditions.push(eq(notifications.priority, query.priority));
    }

    const where = and(...conditions);

    const [data, countRows] = await Promise.all([
      app.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset),
      app.db.select({ total: count() }).from(notifications).where(where),
    ]);

    return { data, total: countRows[0]?.total ?? 0, limit, offset };
  });

  // GET /api/notifications/count — unread and critical counts
  app.get('/api/notifications/count', { preHandler: app.requireAuth }, async (req) => {
    const userId = req.user!.id;
    const base = and(eq(notifications.userId, userId), isNull(notifications.dismissedAt));

    const [unreadRows, criticalRows] = await Promise.all([
      app.db
        .select({ count: count() })
        .from(notifications)
        .where(and(base, isNull(notifications.readAt))),
      app.db
        .select({ count: count() })
        .from(notifications)
        .where(and(base, isNull(notifications.readAt), eq(notifications.priority, 'critical'))),
    ]);

    return {
      unread: unreadRows[0]?.count ?? 0,
      critical: criticalRows[0]?.count ?? 0,
    };
  });

  // PATCH /api/notifications/:id/read — mark a single notification as read
  app.patch('/api/notifications/:id/read', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const [updated] = await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();

    if (!updated) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    return updated;
  });

  // PATCH /api/notifications/read-all — mark all unread notifications as read
  app.patch('/api/notifications/read-all', { preHandler: app.requireAuth }, async (req) => {
    const userId = req.user!.id;

    const result = await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      )
      .returning({ id: notifications.id });

    return { updated: result.length };
  });

  // PATCH /api/notifications/:id/dismiss — dismiss a single notification
  app.patch(
    '/api/notifications/:id/dismiss',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user!.id;

      const [updated] = await app.db
        .update(notifications)
        .set({ dismissedAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: 'Notification not found' });
      }

      return updated;
    },
  );

  // PATCH /api/notifications/dismiss-all — dismiss all read notifications
  app.patch('/api/notifications/dismiss-all', { preHandler: app.requireAuth }, async (req) => {
    const userId = req.user!.id;

    const result = await app.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNotNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      )
      .returning({ id: notifications.id });

    return { updated: result.length };
  });

  // POST /api/notifications — create a notification (admin only)
  app.post('/api/notifications', { preHandler: app.requireAdmin }, async (req, reply) => {
    const body = req.body as CreateNotificationInput;

    if (!body.user_id || !body.type || !body.title || !body.entity_type || !body.entity_id || !body.created_by) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const notification = await createNotification(app.db, body);
    return reply.code(201).send(notification);
  });
}
