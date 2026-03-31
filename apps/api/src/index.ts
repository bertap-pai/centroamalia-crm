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

// Build logger options without optional properties set to undefined —
// exactOptionalPropertyTypes rejects `transport: undefined`.
const loggerOptions: FastifyServerOptions['logger'] =
  env.NODE_ENV === 'production'
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } };

const app = Fastify({ logger: loggerOptions });

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

  // Health check — unauthenticated, used by load balancers and uptime monitors
  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API listening on port ${env.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
