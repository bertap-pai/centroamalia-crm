import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, lte, isNull } from 'drizzle-orm';
import { workflowSchedules, workflowRuns } from '@crm/db';
import { executeRun } from './workflow-executor.js';

async function workflowSchedulerPlugin(app: FastifyInstance): Promise<void> {
  // Run every minute: check for sleeping runs to resume
  const INTERVAL_MS = 60 * 1000;

  async function tick(): Promise<void> {
    try {
      const now = new Date();

      // Find all schedules that are due and haven't been resumed yet
      const dueSchedules = await app.db
        .select({
          id: workflowSchedules.id,
          runId: workflowSchedules.runId,
        })
        .from(workflowSchedules)
        .where(
          and(
            lte(workflowSchedules.resumeAt, now),
            isNull(workflowSchedules.resumedAt),
          ),
        );

      for (const schedule of dueSchedules) {
        try {
          // Mark as resumed
          await app.db
            .update(workflowSchedules)
            .set({ resumedAt: new Date() })
            .where(eq(workflowSchedules.id, schedule.id));

          // Resume the run
          await executeRun(app.db, schedule.runId);
        } catch (err) {
          app.log.error(
            { err, scheduleId: schedule.id, runId: schedule.runId },
            '[workflow-scheduler] Failed to resume run',
          );
        }
      }
    } catch (err) {
      app.log.error({ err }, '[workflow-scheduler] Tick failed');
    }
  }

  // Run initial tick to catch up on any schedules missed during downtime
  tick();

  const intervalId = setInterval(tick, INTERVAL_MS);

  // Cleanup on server close
  app.addHook('onClose', async () => {
    clearInterval(intervalId);
  });
}

export default fp(workflowSchedulerPlugin, {
  name: 'workflow-scheduler',
});
