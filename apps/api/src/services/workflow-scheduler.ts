import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, lte, isNull } from 'drizzle-orm';
import { workflowSchedules, workflowRuns, workflowEnrollments, workflowTriggerSchedules, contacts } from '@crm/db';
import type { FilterGroup } from '@crm/db';
import { executeRun } from './workflow-executor.js';
import { evaluateFilters } from './workflow-filter.js';

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
          condition: workflowSchedules.condition,
          timeoutAt: workflowSchedules.timeoutAt,
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
          // If this is a wait_until schedule with a condition, check it
          if (schedule.condition) {
            const [run] = await app.db
              .select({ contactId: workflowRuns.contactId })
              .from(workflowRuns)
              .where(eq(workflowRuns.id, schedule.runId))
              .limit(1);

            if (run) {
              const [contact] = await app.db
                .select()
                .from(contacts)
                .where(eq(contacts.id, run.contactId))
                .limit(1);

              const record: Record<string, unknown> = contact
                ? { first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phoneE164 }
                : {};

              const conditionMet = evaluateFilters(schedule.condition as FilterGroup, record);
              const timedOut = schedule.timeoutAt ? new Date() >= schedule.timeoutAt : false;

              if (!conditionMet && !timedOut) {
                // Condition not met and not timed out — reschedule for next check
                const intervalMs = 60 * 60 * 1000; // 1 hour
                await app.db
                  .update(workflowSchedules)
                  .set({ resumeAt: new Date(Date.now() + intervalMs) })
                  .where(eq(workflowSchedules.id, schedule.id));
                continue;
              }
            }
          }

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
      // Also fire any due trigger schedules (time_after_event deferred entries)
      await fireTriggerSchedules(app.db);
    } catch (err) {
      app.log.error({ err }, '[workflow-scheduler] Tick failed');
    }
  }

  async function fireTriggerSchedules(db: FastifyInstance['db']): Promise<void> {
    const now = new Date();

    const due = await db
      .select()
      .from(workflowTriggerSchedules)
      .where(
        and(
          lte(workflowTriggerSchedules.triggerAt, now),
          isNull(workflowTriggerSchedules.triggeredAt),
        ),
      )
      .limit(100);

    for (const entry of due) {
      try {
        // Mark as triggered immediately to prevent duplicate processing
        await db
          .update(workflowTriggerSchedules)
          .set({ triggeredAt: now })
          .where(eq(workflowTriggerSchedules.id, entry.id));

        // Record enrollment
        await db
          .insert(workflowEnrollments)
          .values({ workflowId: entry.workflowId, contactId: entry.contactId })
          .onConflictDoUpdate({
            target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
            set: { lastEnrolledAt: now },
          });

        // Create and execute the run
        const [run] = await db
          .insert(workflowRuns)
          .values({
            workflowId: entry.workflowId,
            contactId: entry.contactId,
            dealId: entry.dealId ?? null,
            status: 'running',
          })
          .returning();

        if (run) {
          await executeRun(db, run.id);
        }
      } catch (err) {
        console.error(`[workflow-scheduler] Failed to fire trigger schedule ${entry.id}:`, err);
      }
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
