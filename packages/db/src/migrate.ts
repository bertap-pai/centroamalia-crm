import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONNECTION_STRING =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/crm';

async function main() {
  const client = postgres(CONNECTION_STRING, { max: 1 });
  const db = drizzle(client);

  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../migrations'),
  });

  console.log('Migrations applied.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
