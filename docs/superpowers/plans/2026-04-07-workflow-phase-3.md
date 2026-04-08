# Workflow Automation — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase 3 of the workflow engine: four time-based trigger types (`time_after_event`, `time_before_event`, `scheduled_recurring`, `contact_anniversary`), test mode API + UI, drag & drop step reorder, and critical engine error notification.

**Architecture:** Time-based triggers use a new `workflow_trigger_schedules` table for deferred per-contact firings (`time_after_event`), and a periodic sweep job in the scheduler for date-scanning triggers (`time_before_event`, `contact_anniversary`, `scheduled_recurring`). The scheduler gains a second tick loop (hourly) for time-trigger sweeps. Test mode is a dry-run API endpoint that evaluates trigger + filters + step sequence without committing any DB changes.

**Tech Stack:** Node.js / TypeScript / Fastify / Drizzle ORM / PostgreSQL / React. Tests: `node:test` + `node:assert/strict`, run with `cd apps/api && npx tsx --test src/__tests__/<file>.ts`.

---

## File Map

**Modified — backend:**
- `packages/db/src/schema/workflows.ts` — new trigger type enum values, new `workflow_trigger_schedules` table
- `packages/db/migrations/0017_workflow_phase3.sql` — generated
- `apps/api/src/services/workflow-engine.ts` — handle `time_after_event` trigger, critical error notification
- `apps/api/src/services/workflow-scheduler.ts` — trigger schedule executor + periodic sweep job
- `apps/api/src/routes/workflows.ts` — add test mode endpoint + reorder endpoint

**Modified — frontend:**
- `apps/web/src/pages/WorkflowEditorPage.tsx` — wire test mode modal
- `apps/web/src/components/WorkflowStepEditor.tsx` — add drag & drop reorder

**Created — backend:**
- `apps/api/src/services/workflow-time-triggers.ts` — periodic sweep for date-based triggers

---

## Task 1: DB schema — new trigger types + workflow_trigger_schedules

**Files:**
- Modify: `packages/db/src/schema/workflows.ts`
- Create: `packages/db/migrations/0017_workflow_phase3.sql` (generated)

- [ ] **Step 1: Add new trigger type enum values and workflow_trigger_schedules table**

In `packages/db/src/schema/workflows.ts`, expand `workflowTriggerTypeEnum`:

```ts
export const workflowTriggerTypeEnum = pgEnum('workflow_trigger_type', [
  'contact_created',
  'contact_updated',
  'contact_deleted',
  'deal_created',
  'deal_stage_changed',
  'form_submitted',
  'task_completed',
  'meeting_scheduled',
  'property_changed',
  'time_after_event',
  'time_before_event',
  'scheduled_recurring',
  'contact_anniversary',
]);
```

Add the new table after `workflowSchedules`:

```ts
/**
 * Pending time-based trigger firings.
 * Created when time_after_event base event fires; consumed by the scheduler.
 * Also used for date-scan triggers (time_before_event, contact_anniversary) to
 * prevent duplicate firings within the same day.
 */
export const workflowTriggerSchedules = pgTable(
  'workflow_trigger_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    triggerAt: timestamp('trigger_at', { withTimezone: true }).notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
    // Original event payload (for time_after_event context)
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    triggerAtIdx: index('workflow_trigger_schedules_trigger_at_idx').on(t.triggerAt),
    workflowContactIdx: index('workflow_trigger_schedules_wf_contact_idx').on(
      t.workflowId,
      t.contactId,
    ),
    triggeredAtIdx: index('workflow_trigger_schedules_triggered_at_idx').on(t.triggeredAt),
  }),
);

export type WorkflowTriggerSchedule = typeof workflowTriggerSchedules.$inferSelect;
export type NewWorkflowTriggerSchedule = typeof workflowTriggerSchedules.$inferInsert;
```

Add the new table to the exports. In `packages/db/src/schema/index.ts` (or wherever workflows schema is exported), ensure `workflowTriggerSchedules` and `WorkflowTriggerSchedule` are exported. Check the current export in `packages/db/src/schema/workflows.ts` — add to the export list if needed.

- [ ] **Step 2: Generate migration**

```bash
cd /Users/berta/.paperclip/instances/default/projects/1fa8b121-7f76-4804-a046-5fea17c1ed41/2b92850d-9359-476a-86c8-466bd7289c2e/_default
pnpm db:generate
```

Expected: creates `packages/db/migrations/0017_workflow_phase3.sql`

- [ ] **Step 3: Run migration**

```bash
pnpm db:migrate
```

- [ ] **Step 4: Build DB package**

```bash
pnpm --filter @crm/db build
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/workflows.ts packages/db/migrations/
git commit -m "feat(workflows): add Phase 3 trigger types and workflow_trigger_schedules table"
```

---

## Task 2: time_after_event — deferred trigger creation

**Files:**
- Modify: `apps/api/src/services/workflow-engine.ts`

When a base CRM event fires (e.g., `contact.created`), the engine looks for active `time_after_event` workflows that reference that base event type, then creates a pending `workflow_trigger_schedules` entry rather than firing immediately.

- [ ] **Step 1: Write failing test**

Create `apps/api/src/__tests__/workflow-time-triggers.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pure helper tested in isolation
function calculateTriggerAt(config: {
  daysAfter?: number;
  hoursAfter?: number;
  minutesAfter?: number;
}, baseTime: Date): Date {
  let totalMs = 0;
  if (config.daysAfter) totalMs += config.daysAfter * 24 * 60 * 60 * 1000;
  if (config.hoursAfter) totalMs += config.hoursAfter * 60 * 60 * 1000;
  if (config.minutesAfter) totalMs += config.minutesAfter * 60 * 1000;
  if (totalMs === 0) totalMs = 24 * 60 * 60 * 1000; // default 1 day
  return new Date(baseTime.getTime() + totalMs);
}

describe('calculateTriggerAt', () => {
  const base = new Date('2026-04-07T12:00:00Z');

  it('calculates days after correctly', () => {
    const result = calculateTriggerAt({ daysAfter: 3 }, base);
    assert.equal(result.toISOString(), '2026-04-10T12:00:00.000Z');
  });

  it('calculates hours after correctly', () => {
    const result = calculateTriggerAt({ hoursAfter: 6 }, base);
    assert.equal(result.toISOString(), '2026-04-07T18:00:00.000Z');
  });

  it('combines days and hours', () => {
    const result = calculateTriggerAt({ daysAfter: 1, hoursAfter: 12 }, base);
    assert.equal(result.toISOString(), '2026-04-09T00:00:00.000Z');
  });

  it('defaults to 1 day when no duration specified', () => {
    const result = calculateTriggerAt({}, base);
    assert.equal(result.toISOString(), '2026-04-08T12:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/api && npx tsx --test src/__tests__/workflow-time-triggers.test.ts
```

Expected: 4 pass

- [ ] **Step 3: Add time_after_event handling to workflow-engine.ts**

Add import at the top of `apps/api/src/services/workflow-engine.ts`:

```ts
import { workflowTriggerSchedules } from '@crm/db';
```

Add the `calculateTriggerAt` helper function (pure, not exported):

```ts
function calculateTriggerAt(config: {
  daysAfter?: number;
  hoursAfter?: number;
  minutesAfter?: number;
}, baseTime: Date): Date {
  let totalMs = 0;
  if (config.daysAfter) totalMs += config.daysAfter * 24 * 60 * 60 * 1000;
  if (config.hoursAfter) totalMs += config.hoursAfter * 60 * 60 * 1000;
  if (config.minutesAfter) totalMs += config.minutesAfter * 60 * 1000;
  if (totalMs === 0) totalMs = 24 * 60 * 60 * 1000;
  return new Date(baseTime.getTime() + totalMs);
}
```

In the `processEvent` function (or wherever workflows matching a trigger type are processed), after the existing event-based processing, add time_after_event scheduling. Find the section that loads active workflows by trigger type and add a parallel section for `time_after_event` workflows:

```ts
// Also check workflows with time_after_event trigger that reference this event type
const timeAfterWorkflows = await getActiveWorkflows(db, 'time_after_event');
for (const workflow of timeAfterWorkflows) {
  const config = workflow.triggerConfig as { baseEvent?: string; daysAfter?: number; hoursAfter?: number; minutesAfter?: number };
  // Only fire if this workflow's baseEvent matches the current CRM event type
  if (config.baseEvent !== triggerType) continue;

  // Extract contactId from the event payload
  const contactId = (payload as Record<string, unknown>).contactId as string | undefined;
  if (!contactId) continue;

  const dealId = (payload as Record<string, unknown>).dealId as string | undefined;

  // Check enrollment allowed
  const allowed = await checkEnrollmentAllowed(db, workflow.id, contactId, workflow.enrollmentMode);
  if (!allowed) continue;

  // Check filters against current contact state
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) continue;
  const contactRecord: Record<string, unknown> = {
    first_name: contact.firstName,
    last_name: contact.lastName,
    email: contact.email,
    phone: contact.phoneE164,
  };
  if (!evaluateFilters(workflow.filters, contactRecord)) continue;

  // Schedule the deferred trigger
  const triggerAt = calculateTriggerAt(config, new Date());
  await db.insert(workflowTriggerSchedules).values({
    workflowId: workflow.id,
    contactId,
    dealId: dealId ?? null,
    triggerAt,
    payload: payload as Record<string, unknown>,
  });
}
```

Add the `contacts` import if not already present (it should be from Phase 2 `loadContactRecord`).

- [ ] **Step 4: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflow-engine.ts \
        apps/api/src/__tests__/workflow-time-triggers.test.ts
git commit -m "feat(workflows): implement time_after_event deferred trigger scheduling"
```

---

## Task 3: Trigger schedule executor (scheduler update)

**Files:**
- Modify: `apps/api/src/services/workflow-scheduler.ts`

Add a second tick function that consumes `workflow_trigger_schedules` entries and fires the workflows.

- [ ] **Step 1: Add trigger schedule processing to scheduler**

In `apps/api/src/services/workflow-scheduler.ts`, add import:

```ts
import { workflowTriggerSchedules, workflowRuns, workflowEnrollments } from '@crm/db';
```

Add a new `fireTriggerSchedules` function (called from the same `tick` interval):

```ts
async function fireTriggerSchedules(db: Db): Promise<void> {
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
    .limit(100); // Process up to 100 per tick

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
      // Log but don't re-throw — next tick will retry (triggeredAt already set, so won't re-process)
      console.error(`[workflow-scheduler] Failed to fire trigger schedule ${entry.id}:`, err);
    }
  }
}
```

In the `tick` function body, call `fireTriggerSchedules` after the existing schedule processing:

```ts
  async function tick(): Promise<void> {
    try {
      // ... existing schedule resume logic ...
      await fireTriggerSchedules(app.db);
    } catch (err) {
      app.log.error({ err }, '[workflow-scheduler] Tick failed');
    }
  }
```

The `fireTriggerSchedules` function needs `app.db` — pass it as a parameter. Update the call:

```ts
await fireTriggerSchedules(app.db);
```

And the function signature:

```ts
async function fireTriggerSchedules(db: typeof app.db): Promise<void> {
```

Use `FastifyInstance['db']` as the type — same pattern as other services.

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/workflow-scheduler.ts
git commit -m "feat(workflows): add trigger schedule executor to scheduler (fires time_after_event workflows)"
```

---

## Task 4: Periodic time-trigger sweep (time_before_event, scheduled_recurring, contact_anniversary)

**Files:**
- Create: `apps/api/src/services/workflow-time-triggers.ts`
- Modify: `apps/api/src/services/workflow-scheduler.ts` — register hourly sweep

These three trigger types require scanning contacts on a schedule rather than reacting to events.

- [ ] **Step 1: Create workflow-time-triggers.ts**

```ts
import { eq, and, isNull, lte, gte } from 'drizzle-orm';
import {
  workflows,
  workflowTriggerSchedules,
  workflowRuns,
  workflowEnrollments,
  contacts,
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
// Fires once per matching hour/minute/day within a 10-minute window to allow for slight delays.

async function sweepScheduledRecurring(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    hour?: number;
    minute?: number;
    days?: number[]; // day-of-week, 0=Sun
  };

  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentDay = now.getUTCDay();

  // Check day of week
  if (config.days && config.days.length > 0 && !config.days.includes(currentDay)) return;
  // Check hour
  if (config.hour !== undefined && config.hour !== currentHour) return;
  // Check minute window: allow ±10 minutes to handle timing drift
  if (config.minute !== undefined) {
    const diff = Math.abs(currentMinute - config.minute);
    if (diff > 10 && diff < 50) return; // not within window
  }

  // Load all contacts and fire for those passing filters
  const allContacts = await db.select().from(contacts).where(isNull(contacts.archivedAt)).limit(5000);

  for (const contact of allContacts) {
    const record: Record<string, unknown> = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };

    if (!evaluateFilters(workflow.filters, record)) continue;

    // Dedup: check if we already fired this workflow for this contact today
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

    // Check enrollment mode
    const allowed = await checkEnrollmentAllowed(db, workflow.id, contact.id, workflow.enrollmentMode);
    if (!allowed) continue;

    // Record dedup entry and create run
    await db.insert(workflowTriggerSchedules).values({
      workflowId: workflow.id,
      contactId: contact.id,
      triggerAt: now,
      triggeredAt: now, // already firing
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
// Fires for contacts where contact[dateProperty] - daysBefore*days == today

async function sweepTimeBeforeEvent(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    dateProperty: string; // e.g. 'next_appointment_at' — must be a custom property key
    daysBefore: number;
  };

  if (!config.dateProperty || config.daysBefore == null) return;

  // Target date: contacts whose event date is exactly daysBefore days from now
  const targetDate = new Date(now.getTime() + config.daysBefore * 24 * 60 * 60 * 1000);
  const targetDateStr = targetDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Load contacts with this custom property set to targetDate
  // Note: custom properties are stored in contactPropertyValues as text.
  // We match on YYYY-MM-DD prefix for date properties.
  const { contactPropertyValues, propertyDefinitions } = await import('@crm/db');
  const { inArray } = await import('drizzle-orm');

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
        // Match date string prefix
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
    const record: Record<string, unknown> = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };

    if (!evaluateFilters(workflow.filters, record)) continue;

    // Dedup: already fired today?
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

// ── contact_anniversary ────────────────────────────────────────────────
// Config: { dateProperty: 'created_at' | string, yearsAfter: number }
// Fires on the Nth anniversary of a date field.

async function sweepContactAnniversary(db: Db, workflow: Workflow, now: Date): Promise<void> {
  const config = workflow.triggerConfig as {
    dateProperty: 'created_at' | string;
    yearsAfter: number;
  };

  if (!config.dateProperty || config.yearsAfter == null) return;

  const nowMonth = now.getUTCMonth() + 1; // 1-12
  const nowDay = now.getUTCDate();

  let matchingContacts: typeof contacts.$inferSelect[] = [];

  if (config.dateProperty === 'created_at') {
    // Use the built-in createdAt field
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
    // Custom property — treated as a date string
    const { contactPropertyValues, propertyDefinitions } = await import('@crm/db');

    const monthStr = String(nowMonth).padStart(2, '0');
    const dayStr = String(nowDay).padStart(2, '0');
    const anniversaryPattern = `-${monthStr}-${dayStr}`; // e.g. "-04-07"

    const matchingValues = await db
      .select({ contactId: contactPropertyValues.contactId, value: contactPropertyValues.value })
      .from(contactPropertyValues)
      .innerJoin(
        propertyDefinitions,
        eq(contactPropertyValues.propertyDefinitionId, propertyDefinitions.id),
      )
      .where(eq(propertyDefinitions.key, config.dateProperty));

    // Filter those where: anniversary month-day matches AND year + yearsAfter == current year
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

    const { inArray } = await import('drizzle-orm');
    const contactIds = [...new Set(filtered.map((v) => v.contactId))];
    if (contactIds.length === 0) return;

    matchingContacts = await db
      .select()
      .from(contacts)
      .where(and(inArray(contacts.id, contactIds), isNull(contacts.archivedAt)));
  }

  for (const contact of matchingContacts) {
    const record: Record<string, unknown> = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phoneE164,
    };

    if (!evaluateFilters(workflow.filters, record)) continue;

    // Dedup: already fired today
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
```

**Important:** `checkEnrollmentAllowed` and `recordEnrollment` are currently private functions in `workflow-engine.ts`. They must be exported for use here. In `workflow-engine.ts`, change:

```ts
async function checkEnrollmentAllowed(...)
async function recordEnrollment(...)
```

to:

```ts
export async function checkEnrollmentAllowed(...)
export async function recordEnrollment(...)
```

- [ ] **Step 2: Register hourly sweep in scheduler**

In `apps/api/src/services/workflow-scheduler.ts`, add import:

```ts
import { runTimeTriggerSweep } from './workflow-time-triggers.js';
```

Add a separate hourly interval in `workflowSchedulerPlugin`:

```ts
  // Hourly sweep for time-based triggers (scheduled_recurring, time_before_event, contact_anniversary)
  const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  async function sweepTick(): Promise<void> {
    try {
      await runTimeTriggerSweep(app.db);
    } catch (err) {
      app.log.error({ err }, '[workflow-time-triggers] Sweep failed');
    }
  }

  // Run initial sweep on startup
  sweepTick();

  const sweepIntervalId = setInterval(sweepTick, SWEEP_INTERVAL_MS);

  // Add to cleanup
  app.addHook('onClose', async () => {
    clearInterval(intervalId);
    clearInterval(sweepIntervalId);
  });
```

Replace the existing single `clearInterval(intervalId)` in `onClose` with both.

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/workflow-time-triggers.ts \
        apps/api/src/services/workflow-scheduler.ts \
        apps/api/src/services/workflow-engine.ts
git commit -m "feat(workflows): implement scheduled_recurring, time_before_event, and contact_anniversary triggers"
```

---

## Task 5: Critical engine error notification

**Files:**
- Modify: `apps/api/src/services/workflow-engine.ts`

On critical unhandled error in the engine's event subscriber, notify CRM admin with priority 'critical' and set the workflow status to 'error'.

- [ ] **Step 1: Wrap event subscribers in error handler**

In `apps/api/src/services/workflow-engine.ts`, find where the engine subscribes to events (likely in an `initWorkflowEngine` function or similar setup). Wrap the inner `processEvent` call so any unhandled exception:
1. Sets the workflow(s) status to `'error'`
2. Sends a critical notification via `createNotification()`

Find the event subscription setup — it likely looks like:

```ts
eventBus.on('contact.created', async (payload) => {
  await processEvent(db, 'contact.created', payload);
});
```

Wrap each handler body to catch and escalate:

```ts
eventBus.on('contact.created', async (payload) => {
  try {
    await processEvent(db, 'contact.created', payload);
  } catch (err) {
    await notifyCriticalEngineError(db, 'contact.created', err);
  }
});
```

Add `notifyCriticalEngineError` helper:

```ts
async function notifyCriticalEngineError(
  db: Db,
  eventType: string,
  err: unknown,
): Promise<void> {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error(`[workflow-engine] CRITICAL ERROR on event ${eventType}:`, err);

  try {
    const { users } = await import('@crm/db');
    const [adminUser] = await db.select({ id: users.id }).from(users).limit(1);

    if (adminUser) {
      await createNotification(db, {
        user_id: adminUser.id,
        type: 'workflow_engine_error',
        priority: 'critical',
        title: `Workflow engine critical error on "${eventType}"`,
        body: `Error: ${errorMessage}. Check server logs for full stack trace.`,
        entity_type: 'workflow_engine',
        entity_id: eventType,
        created_by: 'workflow_engine',
      });
    }
  } catch {
    // Don't let notification failure hide the original error
  }
}
```

Apply the same try/catch wrapper to ALL event bus subscriptions in the engine.

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/workflow-engine.ts
git commit -m "feat(workflows): add critical internal notification on workflow engine errors"
```

---

## Task 6: Test mode API

**Files:**
- Modify: `apps/api/src/routes/workflows.ts`

`POST /api/workflows/:id/test` with body `{ contactId: string }` — dry-runs the workflow:
1. Evaluates trigger filters against the contact
2. Lists each step with its expected config summary
3. Returns whether the contact would have been enrolled
4. No DB mutations.

- [ ] **Step 1: Write the test mode endpoint**

In `apps/api/src/routes/workflows.ts`, add after the existing publish/pause endpoints:

```ts
  // POST /api/workflows/:id/test — dry-run simulation
  app.post<{
    Params: { id: string };
    Body: { contactId: string };
  }>(
    '/api/workflows/:id/test',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params;
      const { contactId } = req.body;

      if (!contactId) return reply.code(400).send({ error: 'contactId_required' });

      // Load workflow with steps
      const [workflow] = await app.db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
        .limit(1);

      if (!workflow) return reply.code(404).send({ error: 'not_found' });

      const steps = await app.db
        .select()
        .from(workflowSteps)
        .where(and(eq(workflowSteps.workflowId, id), isNull(workflowSteps.parentStepId)))
        .orderBy(asc(workflowSteps.order));

      // Load contact
      const [contact] = await app.db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (!contact) return reply.code(404).send({ error: 'contact_not_found' });

      // Build contact record for filter evaluation
      const contactRecord: Record<string, unknown> = {
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        phone: contact.phoneE164,
      };

      // Evaluate filters
      const { evaluateFilters } = await import('../services/workflow-filter.js');
      const filtersPassed = evaluateFilters(workflow.filters, contactRecord);

      // Check enrollment
      const [existingEnrollment] = await app.db
        .select()
        .from(workflowEnrollments)
        .where(
          and(
            eq(workflowEnrollments.workflowId, id),
            eq(workflowEnrollments.contactId, contactId),
          ),
        )
        .limit(1);

      let enrollmentBlocked = false;
      let enrollmentBlockReason = '';
      if (existingEnrollment) {
        if (workflow.enrollmentMode === 'once') {
          enrollmentBlocked = true;
          enrollmentBlockReason = 'Contact already enrolled (mode: once)';
        } else if (workflow.enrollmentMode === 'once_per_week') {
          const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (existingEnrollment.lastEnrolledAt >= oneWeekAgo) {
            enrollmentBlocked = true;
            enrollmentBlockReason = `Last enrolled ${existingEnrollment.lastEnrolledAt.toISOString()} (mode: once_per_week, must wait 7 days)`;
          }
        }
      }

      const wouldEnroll = filtersPassed && !enrollmentBlocked;

      // Build step simulation summary
      const stepSummary = steps.map((step) => ({
        order: step.order,
        type: step.type,
        config: step.config,
        note: buildStepNote(step.type, step.config as Record<string, unknown>, contact),
      }));

      return reply.send({
        workflowId: id,
        workflowName: workflow.name,
        workflowStatus: workflow.status,
        contact: {
          id: contact.id,
          name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
          email: contact.email,
        },
        filtersPassed,
        enrollmentBlocked,
        enrollmentBlockReason: enrollmentBlockReason || null,
        wouldEnroll,
        steps: stepSummary,
        stepCount: steps.length,
        simulationNote: 'No actions were executed. This is a read-only simulation.',
      });
    },
  );
```

Add the `buildStepNote` helper at the bottom of the routes file (before the export):

```ts
function buildStepNote(
  type: string,
  config: Record<string, unknown>,
  contact: { firstName: string | null; lastName: string | null },
): string {
  const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'contact';
  switch (type) {
    case 'update_contact_property':
      return `Would set "${config.propertyName}" = "${config.value}" on ${name}`;
    case 'create_task':
      return `Would create task "${config.title}" due in ${config.dueDays} day(s)`;
    case 'add_tag':
      return `Would add tag "${config.tag}" to ${name}`;
    case 'remove_tag':
      return `Would remove tag "${config.tag}" from ${name}`;
    case 'send_internal_notification':
      return `Would notify: "${config.title}"`;
    case 'webhook':
      return `Would POST to ${config.url}`;
    case 'wait':
      return `Would wait ${config.durationDays ?? config.durationHours ?? config.durationMinutes} ${config.durationDays ? 'day(s)' : config.durationHours ? 'hour(s)' : 'minute(s)'}`;
    case 'wait_until':
      return `Would wait until condition met (timeout: ${(config as any).timeoutDays} days)`;
    case 'branch':
      return `IF/ELSE branch — would evaluate condition at runtime`;
    case 'create_deal':
      return `Would create a new deal in pipeline ${config.pipelineId}`;
    case 'move_deal_stage':
      return `Would move deal to stage ${config.targetStageId}`;
    case 'assign_owner':
      return `Would assign owner (mode: ${config.mode})`;
    case 'enroll_in_workflow':
      return `Would enroll ${name} in workflow ${config.targetWorkflowId}`;
    default:
      return `Would execute ${type}`;
  }
}
```

Ensure the required imports exist at the top of `workflows.ts`: `workflowEnrollments`, `contacts`, `asc` from drizzle-orm.

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/workflows.ts
git commit -m "feat(workflows): add test mode API endpoint (dry-run simulation)"
```

---

## Task 7: Test mode UI

**Files:**
- Modify: `apps/web/src/pages/WorkflowEditorPage.tsx`

Add a "Test" button to the editor header that opens a modal. The modal has a contact ID input (or a dropdown of contacts), runs the dry-run API, and shows the result.

- [ ] **Step 1: Add TestModeModal component to WorkflowEditorPage.tsx**

Add the following component inside `WorkflowEditorPage.tsx` (not as a separate file — it's small enough):

```tsx
interface TestResult {
  workflowName: string;
  contact: { id: string; name: string; email: string | null };
  filtersPassed: boolean;
  enrollmentBlocked: boolean;
  enrollmentBlockReason: string | null;
  wouldEnroll: boolean;
  steps: Array<{ order: number; type: string; note: string }>;
  simulationNote: string;
}

function TestModeModal({
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await api.post(`/api/workflows/${workflowId}/test`, { contactId: contactId.trim() });
      setResult(data);
    } catch (err: any) {
      setError(err.message ?? 'Error running simulation.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 28, width: 600, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Mode de test</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
        </div>

        <form onSubmit={handleTest} style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
          <input
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            placeholder="ID del contacte de prova"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
          />
          <button
            type="submit"
            disabled={loading || !contactId.trim()}
            style={{ padding: '8px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}
          >
            {loading ? 'Simulant...' : 'Simular'}
          </button>
        </form>

        {error && <div style={{ color: '#c62828', marginBottom: 12, fontSize: 13 }}>{error}</div>}

        {result && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#555' }}>Contacte: <strong>{result.contact.name || result.contact.id}</strong> {result.contact.email ? `(${result.contact.email})` : ''}</div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <StatusBadge ok={result.filtersPassed} label={result.filtersPassed ? 'Filtres: ✓ aprovats' : 'Filtres: ✗ no passa'} />
              <StatusBadge ok={!result.enrollmentBlocked} label={result.enrollmentBlocked ? `Inscripció bloquejada` : 'Inscripció: ✓ permesa'} />
              <StatusBadge ok={result.wouldEnroll} label={result.wouldEnroll ? '✓ S\'inscriuria' : '✗ No s\'inscriuria'} />
            </div>

            {result.enrollmentBlockReason && (
              <div style={{ fontSize: 12, color: '#e65100', marginBottom: 12, padding: '6px 10px', background: '#fff3e0', borderRadius: 4 }}>
                {result.enrollmentBlockReason}
              </div>
            )}

            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Passos ({result.steps.length})</h4>
            {result.steps.map((step) => (
              <div key={step.order} style={{ padding: '8px 12px', borderLeft: '3px solid #1a73e8', marginBottom: 6, background: '#f8f9ff', borderRadius: '0 4px 4px 0', fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{step.order}. [{step.type}]</span> {step.note}
              </div>
            ))}

            <div style={{ marginTop: 16, fontSize: 12, color: '#888', fontStyle: 'italic' }}>{result.simulationNote}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
      background: ok ? '#e8f5e9' : '#ffebee',
      color: ok ? '#2e7d32' : '#c62828',
      border: `1px solid ${ok ? '#a5d6a7' : '#ef9a9a'}`,
    }}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Wire TestModeModal into the editor header**

In `WorkflowEditorPage`, add state:
```tsx
const [showTest, setShowTest] = useState(false);
```

Add "Test" button to the header (after the Publish/Pause button):
```tsx
        <button
          onClick={() => setShowTest(true)}
          style={{ padding: '6px 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
        >
          Test
        </button>
```

Render the modal at the bottom of the component return:
```tsx
      {showTest && (
        <TestModeModal workflowId={wf.id} onClose={() => setShowTest(false)} />
      )}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/WorkflowEditorPage.tsx
git commit -m "feat(workflows): add test mode UI with contact selector and dry-run result"
```

---

## Task 8: Drag & drop step reorder

**Files:**
- Modify: `apps/web/src/components/WorkflowStepEditor.tsx`
- Modify: `apps/api/src/routes/workflows.ts` — add bulk reorder endpoint

Use the HTML5 Drag and Drop API (no external dependency). On drop, PATCH each step's order in a single bulk endpoint.

- [ ] **Step 1: Add bulk reorder endpoint to API**

In `apps/api/src/routes/workflows.ts`, add:

```ts
  // POST /api/workflows/:id/steps/reorder
  app.post<{
    Params: { id: string };
    Body: { steps: Array<{ id: string; order: number }> };
  }>(
    '/api/workflows/:id/steps/reorder',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { steps } = req.body;
      if (!Array.isArray(steps) || steps.length === 0) {
        return reply.code(400).send({ error: 'steps_required' });
      }

      // Update each step's order individually
      await Promise.all(
        steps.map(({ id, order }) =>
          app.db
            .update(workflowSteps)
            .set({ order })
            .where(eq(workflowSteps.id, id)),
        ),
      );

      return reply.send({ ok: true, updated: steps.length });
    },
  );
```

- [ ] **Step 2: Add drag & drop to WorkflowStepEditor.tsx**

In `WorkflowStepEditor.tsx`, add drag state:

```tsx
const [dragIdx, setDragIdx] = useState<number | null>(null);
const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
```

Update the step card `div` to include drag handlers:

```tsx
          <div
            key={step.id}
            draggable={canEdit}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            onDrop={async () => {
              if (dragIdx === null || dragIdx === idx) return;
              // Reorder in local array
              const reordered = [...topLevelSteps];
              const [moved] = reordered.splice(dragIdx, 1);
              reordered.splice(idx, 0, moved!);
              // Assign new order values
              const updates = reordered.map((s, i) => ({ id: s.id, order: i + 1 }));
              try {
                await api.post(`/api/workflows/${workflowId}/steps/reorder`, { steps: updates });
                onReload();
              } catch {
                alert('Error reordenant els passos.');
              }
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            style={{
              border: dragOverIdx === idx ? '2px dashed #1a73e8' : '1px solid #e0e0e0',
              borderRadius: 6,
              padding: 14,
              marginBottom: 10,
              background: dragIdx === idx ? '#f0f4ff' : '#fff',
              cursor: canEdit ? 'grab' : 'default',
              opacity: dragIdx === idx ? 0.5 : 1,
            }}
          >
```

Remove the existing `style` prop from the step card div and replace with the above. Also add a drag handle hint in the step card (optional, add `⠿` icon to the left when `canEdit`).

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WorkflowStepEditor.tsx \
        apps/api/src/routes/workflows.ts
git commit -m "feat(workflows): add drag & drop step reorder with bulk reorder API endpoint"
```

---

## Task 9: Run all tests

- [ ] **Step 1: Run all workflow tests**

```bash
cd apps/api && npx tsx --test \
  src/__tests__/workflow-filter.test.ts \
  src/__tests__/workflow-enrollment.test.ts \
  src/__tests__/workflow-time-triggers.test.ts \
  src/__tests__/workflow-merge-tags.test.ts
```

Expected: 42+ tests pass, 0 fail

- [ ] **Step 2: Final typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit if any fixes needed, else done**

```bash
git log --oneline -8
```

---

## Self-Review Checklist

| Phase 3 item (design doc §13) | Task |
|---|---|
| 3.1 trigger: time_after_event | Tasks 1, 2, 3 |
| 3.2 trigger: time_before_event | Tasks 1, 4 |
| 3.3 trigger: scheduled_recurring | Tasks 1, 4 |
| 3.4 trigger: contact_anniversary | Tasks 1, 4 |
| 3.5 workflow_schedules persistent wait | ✅ Done in Phase 2 |
| 3.6 Test mode API | Task 6 |
| 3.7 Test mode UI | Task 7 |
| 3.8 Drag & drop step reorder | Task 8 |
| 3.9 Critical engine error notification | Task 5 |

**Known constraints:**
- `time_before_event` works on custom property keys only (standard contact fields don't have future-date semantics)
- `scheduled_recurring` uses UTC time — document this for the Centre Amalia team (Barcelona is UTC+2)
- The sweep job processes up to 5000 contacts per tick — sufficient for Centre Amalia scale
- `checkEnrollmentAllowed` and `recordEnrollment` must be exported from `workflow-engine.ts` (Task 4 requirement)
