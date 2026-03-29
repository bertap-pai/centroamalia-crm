import './types.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import dbPlugin from './plugins/db.js';
import sessionPlugin from './plugins/session.js';
import oauthPlugin from './plugins/oauth.js';
import auditPlugin from './plugins/audit.js';
import { requireAuth, requireAdmin } from './lib/require-auth.js';
import authRoutes from './routes/auth.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

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

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API listening on port ${env.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
