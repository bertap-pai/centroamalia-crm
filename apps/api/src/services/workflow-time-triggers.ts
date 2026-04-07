import { eq, and, isNull, lte, gte, inArray } from 'drizzle-orm';
import {
  workflows,
  workflowTriggerSchedules,
  workflowRuns,
  contacts,
  contactPropertyValues,
  propertyDefinitions,
  type Workflow,
} from '@crm/db';
import type { FastifyInstance } from 'fastify';
import { evaluateFilters } from './workflow-filter.js';
import { checkEnrollmentAllowed, recordEnrollment } from './workflow-engine.js';
import { executeRun } from './workflow-executor.js';

type Db = FastifyInstance['db'];

/**
 * Runs the periodic sweep for time-based trigger types.
 * Call this hourly. It handles:
 *   - scheduled_recurring: checks if cron-like config matches current hour
 *   - time_before_event: finds contacts with upcoming date fields
 *   - contact_anniversary: finds contacts with anniversaries today
 */
export async function runTimeTriggerSweep(db: Db): Promise<void> {
  const now = new Date();

  // Load all active time-based (non-event) workflows
  const timeWorkflows = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.status, 'active'),
        isNull(workflows.deletedAt),
      ),
    );

  const periodic = timeWorkflows.filter((w) =>
    ['scheduled_recurring', 'time_before_event', 'contact_anniversary'].includes(w.triggerType),
  );

  for (const workflow of periodic) {
    try {
      if (workflow.triggerType === 'scheduled_recurring') {
        await sweepScheduledRecurring(db, workflow, now);
      } else if (workflow.triggerType === 'time_before_event') {
        await sweepTimeBeforeEvent(db, workflow, now);
      } else if (workflow.triggerType === 'contact_anniversary') {
        await sweepContactAnniversary(db, workflow, now);
      }
    } catch (err) {
      console.error(`[time-triggers] sweep failed for workflow ${workflow.id}:`, err);
    }
  }
}

// ── scheduled_recurring ────────────────────────────────────────────────
// Config: { hour: number (0-23), minute: number (0-59), days: number[] (0=Sun...6=Sat) }

async function sweepScheduledRecurring(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    hour?: number;
    minute?: number;
    days?: number[];
  };

  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentDay = now.getUTCDay();

  if (config.days && config.days.length > 0 && !config.days.includes(currentDay)) return;
  if (config.hour !== undefined && config.hour !== currentHour) return;
  if (config.minute !== undefined) {
    const diff = Math.abs(currentMinute - config.minute);
    if (diff > 10 && diff < 50) return;
  }

  const allContacts = await db.select().from(contacts).where(isNull(contacts.archivedAt)).limit(5000);

  for (const contact of allContacts) {
    const record: Record<string, unknown> = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };

    if (!evaluateFilters(workflow.filters, record)) continue;

    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    const [alreadyFired] = await db
      .select()
      .from(workflowTriggerSchedules)
      .where(
        and(
          eq(workflowTriggerSchedules.workflowId, workflow.id),
          eq(workflowTriggerSchedules.contactId, contact.id),
          gte(workflowTriggerSchedules.createdAt, todayStart),
        ),
      )
      .limit(1);

    if (alreadyFired) continue;

    const allowed = await checkEnrollmentAllowed(db, workflow.id, contact.id, workflow.enrollmentMode);
    if (!allowed) continue;

    await db.insert(workflowTriggerSchedules).values({
      workflowId: workflow.id,
      contactId: contact.id,
      triggerAt: now,
      triggeredAt: now,
    });

    await recordEnrollment(db, workflow.id, contact.id);

    const [run] = await db
      .insert(workflowRuns)
      .values({ workflowId: workflow.id, contactId: contact.id, status: 'running' })
      .returning();

    if (run) {
      setImmediate(() => executeRun(db, run.id));
    }
  }
}

// ── time_before_event ──────────────────────────────────────────────────
// Config: { dateProperty: string, daysBefore: number }

async function sweepTimeBeforeEvent(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    dateProperty: string;
    daysBefore: number;
  };

  if (!config.dateProperty || config.daysBefore == null) return;

  const targetDate = new Date(now.getTime() + config.daysBefore * 24 * 60 * 60 * 1000);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  const matchingValues = await db
    .select({ contactId: contactPropertyValues.contactId })
    .from(contactPropertyValues)
    .innerJoin(
      propertyDefinitions,
      eq(contactPropertyValues.propertyDefinitionId, propertyDefinitions.id),
    )
    .where(
      and(
        eq(propertyDefinitions.key, config.dateProperty),
        gte(contactPropertyValues.value, targetDateStr),
        lte(contactPropertyValues.value, targetDateStr + 'T23:59:59'),
      ),
    );

  const contactIds = [...new Set(matchingValues.map((v) => v.contactId))];
  if (contactIds.length === 0) return;

  const matchingContacts = await db
    .select()
    .from(contacts)
    .where(and(inArray(contacts.id, contactIds), isNull(contacts.archivedAt)));

  for (const contact of matchingContacts) {
    await fireForContact(db, workflow, contact, now);
  }
}

// ── contact_anniversary ────────────────────────────────────────────────
// Config: { dateProperty: 'created_at' | string, yearsAfter: number }

async function sweepContactAnniversary(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    dateProperty: 'created_at' | string;
    yearsAfter: number;
  };

  if (!config.dateProperty || config.yearsAfter == null) return;

  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();

  let matchingContacts: typeof contacts.$inferSelect[] = [];

  if (config.dateProperty === 'created_at') {
    const allContacts = await db.select().from(contacts).where(isNull(contacts.archivedAt)).limit(10000);
    matchingContacts = allContacts.filter((c) => {
      const d = new Date(c.createdAt);
      const targetYear = d.getUTCFullYear() + config.yearsAfter;
      return (
        now.getUTCFullYear() === targetYear &&
        d.getUTCMonth() + 1 === nowMonth &&
        d.getUTCDate() === nowDay
      );
    });
  } else {
    const matchingValues = await db
      .select({ contactId: contactPropertyValues.contactId, value: contactPropertyValues.value })
      .from(contactPropertyValues)
      .innerJoin(
        propertyDefinitions,
        eq(contactPropertyValues.propertyDefinitionId, propertyDefinitions.id),
      )
      .where(eq(propertyDefinitions.key, config.dateProperty));

    const filtered = matchingValues.filter((v) => {
      if (!v.value) return false;
      const d = new Date(v.value);
      if (isNaN(d.getTime())) return false;
      const targetYear = d.getUTCFullYear() + config.yearsAfter;
      return (
        now.getUTCFullYear() === targetYear &&
        d.getUTCMonth() + 1 === nowMonth &&
        d.getUTCDate() === nowDay
      );
    });

    const contactIds = [...new Set(filtered.map((v) => v.contactId))];
    if (contactIds.length === 0) return;

    matchingContacts = await db
      .select()
      .from(contacts)
      .where(and(inArray(contacts.id, contactIds), isNull(contacts.archivedAt)));
  }

  for (const contact of matchingContacts) {
    await fireForContact(db, workflow, contact, now);
  }
}

// ── Shared helper for date-scan triggers ────────────────────────────────

async function fireForContact(
  db: Db,
  workflow: Workflow,
  contact: typeof contacts.$inferSelect,
  now: Date,
): Promise<void> {
  const record: Record<string, unknown> = {
    first_name: contact.firstName,
    last_name: contact.lastName,
    email: contact.email,
    phone: contact.phoneE164,
  };

  if (!evaluateFilters(workflow.filters, record)) return;

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const [alreadyFired] = await db
    .select()
    .from(workflowTriggerSchedules)
    .where(
      and(
        eq(workflowTriggerSchedules.workflowId, workflow.id),
        eq(workflowTriggerSchedules.contactId, contact.id),
        gte(workflowTriggerSchedules.createdAt, todayStart),
      ),
    )
    .limit(1);

  if (alreadyFired) return;

  const allowed = await checkEnrollmentAllowed(db, workflow.id, contact.id, workflow.enrollmentMode);
  if (!allowed) return;

  await db.insert(workflowTriggerSchedules).values({
    workflowId: workflow.id,
    contactId: contact.id,
    triggerAt: now,
    triggeredAt: now,
  });

  await recordEnrollment(db, workflow.id, contact.id);

  const [run] = await db
    .insert(workflowRuns)
    .values({ workflowId: workflow.id, contactId: contact.id, status: 'running' })
    .returning();

  if (run) {
    setImmediate(() => executeRun(db, run.id));
  }
}
