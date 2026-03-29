import type { User, AuditLog } from '@crm/db';
import type { OAuth2Namespace } from '@fastify/oauth2';
import type postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@crm/db';

// Re-derive Db type with schema so query builder works
type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

type AuditOpts = {
  userId: string | undefined;
  action: 'create' | 'update' | 'delete' | 'archive' | 'restore';
  objectType: string;
  objectId: string;
  diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
};

declare module 'fastify' {
  interface FastifyInstance {
    db: DbInstance;
    googleOAuth2: OAuth2Namespace;
    requireAuth: (
      req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
    requireAdmin: (
      req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
    audit: (opts: AuditOpts) => Promise<void>;
  }

  interface FastifyRequest {
    user?: User;
  }

  interface Session {
    userId?: string;
  }
}
