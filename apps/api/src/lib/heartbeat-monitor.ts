import type { FastifyInstance } from 'fastify';
import { serverHeartbeats, users } from '@crm/db';
import { eq, sql } from 'drizzle-orm';
import { env } from '../env.js';
import { createNotification } from '../services/notifications.js';

const HEARTBEAT_ROW_ID = 'main';
const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function upsertHeartbeat(db: FastifyInstance['db']): Promise<void> {
  await db
    .insert(serverHeartbeats)
    .values({ id: HEARTBEAT_ROW_ID, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: serverHeartbeats.id,
      set: { lastSeenAt: new Date(), updatedAt: new Date() },
    });
}

export async function startHeartbeatMonitor(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const thresholdMs = env.DOWNTIME_ALERT_THRESHOLD_MINUTES * 60_000;

  // 1. Check for downtime gap on startup
  const rows = await db
    .select({ lastSeenAt: serverHeartbeats.lastSeenAt })
    .from(serverHeartbeats)
    .where(eq(serverHeartbeats.id, HEARTBEAT_ROW_ID));

  const existing = rows[0];

  if (!existing) {
    // First-ever startup — insert row and skip alert
    app.log.info('Heartbeat monitor: first run, inserting initial heartbeat row');
    await upsertHeartbeat(db);
  } else {
    const gapMs = Date.now() - existing.lastSeenAt.getTime();
    const gapMinutes = Math.round(gapMs / 60_000);

    if (gapMs > thresholdMs) {
      app.log.warn(
        `Heartbeat monitor: server was offline for ~${gapMinutes} minutes (threshold: ${env.DOWNTIME_ALERT_THRESHOLD_MINUTES} min)`,
      );

      // Notify all users
      const allUsers = await db.select({ id: users.id }).from(users);

      for (const user of allUsers) {
        await createNotification(db, {
          user_id: user.id,
          type: 'system_alert',
          priority: 'critical',
          title: 'Server was offline \u2014 check for missed leads',
          body: `The API was unreachable for ~${gapMinutes} minutes. Review the lead submissions inbox for entries that may have arrived during downtime.`,
          entity_type: 'lead_submissions',
          entity_id: NIL_UUID,
          created_by: 'system',
        });
      }

      app.log.info(`Heartbeat monitor: sent downtime alerts to ${allUsers.length} user(s)`);
    } else {
      app.log.info(`Heartbeat monitor: server was offline for ~${gapMinutes} min (within threshold)`);
    }

    // Upsert after gap check
    await upsertHeartbeat(db);
  }

  // 2. Keep-alive: upsert every 5 minutes
  const interval = setInterval(() => {
    upsertHeartbeat(db).catch((err) => {
      app.log.error({ err }, 'Heartbeat monitor: keep-alive upsert failed');
    });
  }, KEEP_ALIVE_INTERVAL_MS);

  // Clean up on server close
  app.addHook('onClose', async () => {
    clearInterval(interval);
  });
}
