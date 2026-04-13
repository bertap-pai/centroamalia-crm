import './types.js';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import dbPlugin from './plugins/db.js';
import sessionPlugin from './plugins/session.js';
import oauthPlugin from './plugins/oauth.js';
import auditPlugin from './plugins/audit.js';
import { requireAuth, requireAdmin } from './lib/require-auth.js';
import authRoutes from './routes/auth.js';
import contactsRoutes from './routes/contacts.js';
import propertiesRoutes from './routes/properties.js';
import savedViewsRoutes from './routes/saved-views.js';
import pipelinesRoutes from './routes/pipelines.js';
import dealsRoutes from './routes/deals.js';
import notesTasksRoutes from './routes/notes-tasks.js';
import importRoutes from './routes/import.js';
import exportRoutes from './routes/export.js';
import usersRoutes from './routes/users.js';
import formsRoutes from './routes/forms.js';
import listsRoutes from './routes/lists.js';
import metaWebhookRoutes from './routes/webhooks/meta.js';
import tiktokWebhookRoutes from './routes/webhooks/tiktok.js';
import notificationsRoutes from './routes/notifications.js';
import workflowsRoutes from './routes/workflows.js';
import contactLayoutRoutes from './routes/contactLayout.js';
import workflowEmitterPlugin from './plugins/workflow-emitter.js';
import workflowSchedulerPlugin from './services/workflow-scheduler.js';
import metaLeadPollerPlugin from './services/meta-lead-poller.js';
import { initWorkflowEngine } from './services/workflow-engine.js';
import { startHeartbeatMonitor } from './lib/heartbeat-monitor.js';
import { notifications } from '@crm/db';
import { lt, sql } from 'drizzle-orm';

// Build logger options without optional properties set to undefined —
// exactOptionalPropertyTypes rejects `transport: undefined`.
const loggerOptions: FastifyServerOptions['logger'] =
  env.NODE_ENV === 'production'
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } };

const app = Fastify({ logger: loggerOptions, trustProxy: true });

async function start() {
  // Core infrastructure
  await app.register(cors, {
    origin: env.WEB_URL,
    credentials: true,
  });

  await app.register(dbPlugin);
  await app.register(sessionPlugin);
  await app.register(oauthPlugin);
  await app.register(auditPlugin);
  await app.register(workflowEmitterPlugin);

  // Auth decorators — registered after plugins so db/session are available
  app.decorate('requireAuth', requireAuth);
  app.decorate('requireAdmin', requireAdmin);

  // Routes
  await app.register(authRoutes);
  await app.register(contactsRoutes);
  await app.register(propertiesRoutes);
  await app.register(savedViewsRoutes);
  await app.register(pipelinesRoutes);
  await app.register(dealsRoutes);
  await app.register(notesTasksRoutes);
  await app.register(importRoutes);
  await app.register(exportRoutes);
  await app.register(usersRoutes);
  await app.register(formsRoutes);
  await app.register(listsRoutes);
  await app.register(metaWebhookRoutes);
  await app.register(tiktokWebhookRoutes);
  await app.register(notificationsRoutes);
  await app.register(workflowsRoutes);
  await app.register(contactLayoutRoutes);

  // Initialize workflow engine (subscribes to event bus)
  initWorkflowEngine(app.db);

  // Register workflow scheduler (node-cron for wait step resumption)
  await app.register(workflowSchedulerPlugin);

  // Register Meta lead poller (60-min safeguard against missed webhooks)
  await app.register(metaLeadPollerPlugin);

  // Health check — unauthenticated, used by load balancers and uptime monitors
  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Downtime detection — check for gap on startup, then upsert every 5 min
  await startHeartbeatMonitor(app);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API listening on port ${env.PORT}`);

  // 90-day notification cleanup — runs once daily
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  async function cleanupOldNotifications() {
    try {
      const cutoff = new Date(Date.now() - 90 * TWENTY_FOUR_HOURS);
      const deleted = await app.db
        .delete(notifications)
        .where(lt(notifications.createdAt, cutoff))
        .returning({ id: notifications.id });
      if (deleted.length > 0) {
        app.log.info(`Cleaned up ${deleted.length} notifications older than 90 days`);
      }
    } catch (err) {
      app.log.error({ err }, 'Notification cleanup failed');
    }
  }
  cleanupOldNotifications();
  setInterval(cleanupOldNotifications, TWENTY_FOUR_HOURS);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
