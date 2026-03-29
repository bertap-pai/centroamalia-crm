import fp from 'fastify-plugin';
import { auditLogs } from '@crm/db';

export default fp(async (app) => {
  app.decorate('audit', async function (opts: {
    userId: string | undefined;
    action: 'create' | 'update' | 'delete' | 'archive' | 'restore';
    objectType: string;
    objectId: string;
    diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  }) {
    try {
      await app.db.insert(auditLogs).values({
        userId: opts.userId ?? null,
        action: opts.action,
        objectType: opts.objectType,
        objectId: opts.objectId,
        diff: opts.diff ?? null,
      });
    } catch (err) {
      // Audit failures must never crash the main request
      app.log.error({ err }, 'audit log write failed');
    }
  });
});
