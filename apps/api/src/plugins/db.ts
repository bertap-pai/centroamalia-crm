import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@crm/db';
import { env } from '../env.js';

export default fp(async (app) => {
  const client = postgres(env.DATABASE_URL);
  const db = drizzle(client, { schema });

  // @ts-expect-error — typed via module augmentation in types.ts
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await client.end();
  });
});
