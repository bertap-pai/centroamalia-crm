import type { FastifyInstance } from 'fastify';
import {
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  asc,
  count,
  inArray,
  sql,
} from 'drizzle-orm';
import {
  workflows,
  workflowSteps,
  workflowRuns,
  workflowStepLogs,
  workflowEnrollments,
  workflowSchedules,
  contacts,
  type NewWorkflow,
  type NewWorkflowStep,
} from '@crm/db';
import { invalidateWorkflowCache, checkEnrollmentAllowed } from '../services/workflow-engine.js';
import { executeRun } from '../services/workflow-executor.js';

export default async function workflowsRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════════════
  // WORKFLOW CRUD
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/workflows — list workflows
  app.get('/api/workflows', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const status = q['status'];
    const triggerType = q['trigger_type'];
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
    const offset = (page - 1) * pageSize;

    const conditions: ReturnType<typeof eq>[] = [isNull(workflows.deletedAt) as any];
    if (status) conditions.push(eq(workflows.status, status as any) as any);
    if (triggerType) conditions.push(eq(workflows.triggerType, triggerType as any) as any);

    const where = and(...conditions);

    const [data, countRows] = await Promise.all([
      app.db
        .select()
        .from(workflows)
        .where(where)
        .orderBy(desc(workflows.updatedAt))
        .limit(pageSize)
        .offset(offset),
      app.db.select({ total: count() }).from(workflows).where(where),
    ]);

    return { data, total: countRows[0]?.total ?? 0, page, pageSize };
  });

  // POST /api/workflows — create workflow
  app.post('/api/workflows', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      triggerType: string;
      triggerConfig?: Record<string, unknown>;
      enrollmentMode?: string;
      filters?: unknown;
      steps?: Array<{
        type: string;
        config: Record<string, unknown>;
        order?: number;
      }>;
    };

    if (!body.name || !body.triggerType) {
      return reply.code(400).send({ error: 'name and triggerType are required' });
    }

    const [workflow] = await app.db
      .insert(workflows)
      .values({
        name: body.name,
        description: body.description ?? null,
        triggerType: body.triggerType as any,
        triggerConfig: body.triggerConfig ?? {},
        enrollmentMode: (body.enrollmentMode as any) ?? 'once',
        filters: (body.filters ?? null) as any,
        status: 'draft',
      })
      .returning();

    if (!workflow) return reply.code(500).send({ error: 'insert_failed' });

    // Create steps if provided
    if (body.steps && body.steps.length > 0) {
      const stepValues: NewWorkflowStep[] = body.steps.map((s, i) => ({
        workflowId: workflow.id,
        order: s.order ?? i,
        type: s.type as any,
        config: s.config,
      }));

      await app.db.insert(workflowSteps).values(stepValues);
    }

    return reply.code(201).send(workflow);
  });

  // GET /api/workflows/:id — get workflow with steps
  app.get('/api/workflows/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [workflow] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!workflow) return reply.code(404).send({ error: 'not_found' });

    const steps = await app.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, id))
      .orderBy(asc(workflowSteps.order));

    return { ...workflow, steps };
  });

  // GET /api/workflows/:id/analytics — run stats and step completion rates
  app.get('/api/workflows/:id/analytics', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [wf] = await app.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!wf) return reply.code(404).send({ error: 'workflow_not_found' });

    // Aggregate run counts by status
    const runStats = await app.db
      .select({
        status: workflowRuns.status,
        cnt: count(),
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .groupBy(workflowRuns.status);

    const statsByStatus = Object.fromEntries(runStats.map((r) => [r.status, Number(r.cnt)]));
    const totalRuns = runStats.reduce((sum, r) => sum + Number(r.cnt), 0);

    // Runs per day — last 30 days
    const runsByDay = await app.db
      .select({
        date: sql<string>`DATE(${workflowRuns.startedAt})`.as('date'),
        cnt: count(),
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, id),
          sql`${workflowRuns.startedAt} >= NOW() - INTERVAL '30 days'`,
        ),
      )
      .groupBy(sql`DATE(${workflowRuns.startedAt})`)
      .orderBy(sql`DATE(${workflowRuns.startedAt})`);

    // Step stats — success/error counts per step type
    const stepStats = await app.db
      .select({
        stepType: workflowStepLogs.stepType,
        result: workflowStepLogs.result,
        cnt: count(),
      })
      .from(workflowStepLogs)
      .innerJoin(workflowRuns, eq(workflowStepLogs.runId, workflowRuns.id))
      .where(eq(workflowRuns.workflowId, id))
      .groupBy(workflowStepLogs.stepType, workflowStepLogs.result);

    // Reshape step stats into { stepType: { ok: N, error: N } }
    const stepStatsMap: Record<string, { ok: number; error: number }> = {};
    for (const row of stepStats) {
      if (!stepStatsMap[row.stepType]) stepStatsMap[row.stepType] = { ok: 0, error: 0 };
      if (row.result === 'ok') stepStatsMap[row.stepType]!.ok = Number(row.cnt);
      if (row.result === 'error') stepStatsMap[row.stepType]!.error = Number(row.cnt);
    }

    const completedRuns = statsByStatus['completed'] ?? 0;
    const failedRuns = statsByStatus['failed'] ?? 0;
    const activeRuns = (statsByStatus['running'] ?? 0) + (statsByStatus['sleeping'] ?? 0);

    return reply.send({
      totalRuns,
      activeRuns,
      completedRuns,
      failedRuns,
      completionRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
      runsByDay: runsByDay.map((r) => ({ date: r.date, count: Number(r.cnt) })),
      stepStats: stepStatsMap,
    });
  });

  // PUT /api/workflows/:id — update workflow (only draft/paused)
  app.put('/api/workflows/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      enrollmentMode?: string;
      filters?: unknown;
      steps?: Array<{
        type: string;
        config: Record<string, unknown>;
        order?: number;
      }>;
    };

    const [existing] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.status !== 'draft' && existing.status !== 'paused') {
      return reply.code(400).send({ error: 'can_only_edit_draft_or_paused' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.triggerType !== undefined) updates.triggerType = body.triggerType;
    if (body.triggerConfig !== undefined) updates.triggerConfig = body.triggerConfig;
    if (body.enrollmentMode !== undefined) updates.enrollmentMode = body.enrollmentMode;
    if (body.filters !== undefined) updates.filters = body.filters;

    const [updated] = await app.db
      .update(workflows)
      .set(updates)
      .where(eq(workflows.id, id))
      .returning();

    // Replace steps if provided
    if (body.steps) {
      await app.db.delete(workflowSteps).where(eq(workflowSteps.workflowId, id));

      if (body.steps.length > 0) {
        const stepValues: NewWorkflowStep[] = body.steps.map((s, i) => ({
          workflowId: id,
          order: s.order ?? i,
          type: s.type as any,
          config: s.config,
        }));
        await app.db.insert(workflowSteps).values(stepValues);
      }
    }

    return updated;
  });

  // DELETE /api/workflows/:id — soft delete
  app.delete('/api/workflows/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [updated] = await app.db
      .update(workflows)
      .set({ deletedAt: new Date(), status: 'archived' })
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'not_found' });

    invalidateWorkflowCache();
    return { success: true };
  });

  // POST /api/workflows/:id/publish — activate workflow
  app.post('/api/workflows/:id/publish', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [workflow] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!workflow) return reply.code(404).send({ error: 'not_found' });

    // Validate: must have at least one step
    const steps = await app.db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, id));

    if (steps.length === 0) {
      return reply.code(400).send({ error: 'workflow_must_have_steps' });
    }

    const [updated] = await app.db
      .update(workflows)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(workflows.id, id))
      .returning();

    invalidateWorkflowCache();
    return updated;
  });

  // POST /api/workflows/:id/pause — pause workflow
  app.post('/api/workflows/:id/pause', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [updated] = await app.db
      .update(workflows)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(workflows.id, id), eq(workflows.status, 'active')))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'not_found_or_not_active' });

    invalidateWorkflowCache();
    return updated;
  });

  // POST /api/workflows/:id/duplicate — clone as new draft
  app.post('/api/workflows/:id/duplicate', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [original] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .limit(1);

    if (!original) return reply.code(404).send({ error: 'not_found' });

    const [clone] = await app.db
      .insert(workflows)
      .values({
        name: `${original.name} (copy)`,
        description: original.description,
        triggerType: original.triggerType,
        triggerConfig: original.triggerConfig,
        enrollmentMode: original.enrollmentMode,
        filters: original.filters,
        status: 'draft',
      })
      .returning();

    if (!clone) return reply.code(500).send({ error: 'clone_failed' });

    // Clone steps
    const originalSteps = await app.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, id))
      .orderBy(asc(workflowSteps.order));

    if (originalSteps.length > 0) {
      await app.db.insert(workflowSteps).values(
        originalSteps.map((s) => ({
          workflowId: clone.id,
          order: s.order,
          type: s.type,
          config: s.config,
          parentStepId: s.parentStepId,
          branch: s.branch,
        })),
      );
    }

    return reply.code(201).send(clone);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RUNS
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/workflows/:id/runs — list runs
  app.get('/api/workflows/:id/runs', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    const status = q['status'];
    const contactId = q['contact_id'];
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
    const offset = (page - 1) * pageSize;

    const conditions: ReturnType<typeof eq>[] = [eq(workflowRuns.workflowId, id) as any];
    if (status) conditions.push(eq(workflowRuns.status, status as any) as any);
    if (contactId) conditions.push(eq(workflowRuns.contactId, contactId) as any);

    const where = and(...conditions);

    const [data, countRows] = await Promise.all([
      app.db
        .select()
        .from(workflowRuns)
        .where(where)
        .orderBy(desc(workflowRuns.startedAt))
        .limit(pageSize)
        .offset(offset),
      app.db.select({ total: count() }).from(workflowRuns).where(where),
    ]);

    return { data, total: countRows[0]?.total ?? 0, page, pageSize };
  });

  // GET /api/workflows/:id/runs/:runId — run detail with step logs
  app.get('/api/workflows/:id/runs/:runId', { preHandler: app.requireAuth }, async (req, reply) => {
    const { runId } = req.params as { id: string; runId: string };

    const [run] = await app.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (!run) return reply.code(404).send({ error: 'not_found' });

    const logs = await app.db
      .select()
      .from(workflowStepLogs)
      .where(eq(workflowStepLogs.runId, runId))
      .orderBy(asc(workflowStepLogs.executedAt));

    return { ...run, stepLogs: logs };
  });

  // POST /api/workflows/:id/runs/:runId/cancel — cancel a run
  app.post(
    '/api/workflows/:id/runs/:runId/cancel',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { runId } = req.params as { id: string; runId: string };

      const [updated] = await app.db
        .update(workflowRuns)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(workflowRuns.id, runId),
            inArray(workflowRuns.status, ['running', 'sleeping'] as any),
          ),
        )
        .returning();

      if (!updated) return reply.code(404).send({ error: 'not_found_or_not_cancellable' });

      return updated;
    },
  );

  // POST /api/workflows/:id/runs/:runId/retry — retry a failed run
  app.post(
    '/api/workflows/:id/runs/:runId/retry',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { runId } = req.params as { id: string; runId: string };

      const [run] = await app.db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'failed')))
        .limit(1);

      if (!run) return reply.code(404).send({ error: 'not_found_or_not_failed' });

      // Reset status to running and clear error
      await app.db
        .update(workflowRuns)
        .set({ status: 'running', errorMessage: null, completedAt: null })
        .where(eq(workflowRuns.id, runId));

      // Re-execute
      executeRun(app.db, runId).catch((err) => {
        app.log.error({ err, runId }, 'Retry run failed');
      });

      return { success: true, runId };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // ENROLLMENT
  // ═══════════════════════════════════════════════════════════════════════

  // POST /api/workflows/:id/enroll — manual enrollment
  app.post('/api/workflows/:id/enroll', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { contact_id: string };

    if (!body.contact_id) {
      return reply.code(400).send({ error: 'contact_id required' });
    }

    const [workflow] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.status, 'active'), isNull(workflows.deletedAt)))
      .limit(1);

    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found_or_not_active' });

    // Record enrollment
    await app.db
      .insert(workflowEnrollments)
      .values({ workflowId: id, contactId: body.contact_id })
      .onConflictDoUpdate({
        target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
        set: { lastEnrolledAt: new Date() },
      });

    // Create and start a run
    const [run] = await app.db
      .insert(workflowRuns)
      .values({
        workflowId: id,
        contactId: body.contact_id,
        status: 'running',
      })
      .returning();

    if (run) {
      executeRun(app.db, run.id).catch((err) => {
        app.log.error({ err, runId: run.id }, 'Manual enrollment run failed');
      });
    }

    return reply.code(201).send({ success: true, runId: run?.id });
  });

  // POST /api/workflows/:id/unenroll — manual unenroll
  app.post('/api/workflows/:id/unenroll', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { contact_id: string };

    if (!body.contact_id) {
      return reply.code(400).send({ error: 'contact_id required' });
    }

    // Remove enrollment
    await app.db
      .delete(workflowEnrollments)
      .where(
        and(
          eq(workflowEnrollments.workflowId, id),
          eq(workflowEnrollments.contactId, body.contact_id),
        ),
      );

    // Cancel any running/sleeping runs for this contact
    await app.db
      .update(workflowRuns)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(
        and(
          eq(workflowRuns.workflowId, id),
          eq(workflowRuns.contactId, body.contact_id),
          inArray(workflowRuns.status, ['running', 'sleeping'] as any),
        ),
      );

    return { success: true };
  });

  // POST /api/workflows/:id/enroll-bulk — enroll multiple contacts at once
  app.post('/api/workflows/:id/enroll-bulk', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { contactIds?: string[] };

    if (!body.contactIds || !Array.isArray(body.contactIds) || body.contactIds.length === 0) {
      return reply.code(400).send({ error: 'contactIds array is required and must be non-empty' });
    }

    // Cap at 500 contacts per call to avoid runaway operations
    if (body.contactIds.length > 500) {
      return reply.code(400).send({ error: 'contactIds must contain at most 500 entries' });
    }

    const [workflow] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.status, 'active'), isNull(workflows.deletedAt)))
      .limit(1);

    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found_or_not_active' });

    let enrolled = 0;
    let skipped = 0;

    for (const contactId of body.contactIds) {
      try {
        // Respect enrollment mode
        const allowed = await checkEnrollmentAllowed(app.db, id, contactId, workflow.enrollmentMode);
        if (!allowed) {
          skipped++;
          continue;
        }

        // Record enrollment
        await app.db
          .insert(workflowEnrollments)
          .values({ workflowId: id, contactId })
          .onConflictDoUpdate({
            target: [workflowEnrollments.workflowId, workflowEnrollments.contactId],
            set: { lastEnrolledAt: new Date() },
          });

        // Create run
        const [run] = await app.db
          .insert(workflowRuns)
          .values({ workflowId: id, contactId, status: 'running' })
          .returning();

        if (run) {
          executeRun(app.db, run.id).catch((err) => {
            app.log.error({ err, runId: run.id }, 'Bulk enrollment run failed');
          });
          enrolled++;
        }
      } catch (err) {
        app.log.error({ err, contactId }, 'Bulk enrollment: error processing contact');
        skipped++;
      }
    }

    return reply.code(200).send({ enrolled, skipped });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MONITORING
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/workflows/queue — sleeping runs with ETA
  app.get('/api/workflows/queue', { preHandler: app.requireAuth }, async () => {
    const data = await app.db
      .select({
        runId: workflowRuns.id,
        workflowId: workflowRuns.workflowId,
        contactId: workflowRuns.contactId,
        status: workflowRuns.status,
        startedAt: workflowRuns.startedAt,
        resumeAt: workflowSchedules.resumeAt,
      })
      .from(workflowRuns)
      .innerJoin(workflowSchedules, eq(workflowRuns.id, workflowSchedules.runId))
      .where(
        and(
          eq(workflowRuns.status, 'sleeping'),
          isNull(workflowSchedules.resumedAt),
        ),
      )
      .orderBy(asc(workflowSchedules.resumeAt));

    return { data };
  });

  // GET /api/workflows/dead-letter — definitively failed runs
  app.get('/api/workflows/dead-letter', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
    const offset = (page - 1) * pageSize;

    const where = eq(workflowRuns.status, 'failed');

    const [data, countRows] = await Promise.all([
      app.db
        .select()
        .from(workflowRuns)
        .where(where)
        .orderBy(desc(workflowRuns.completedAt))
        .limit(pageSize)
        .offset(offset),
      app.db.select({ total: count() }).from(workflowRuns).where(where),
    ]);

    return { data, total: countRows[0]?.total ?? 0, page, pageSize };
  });

  // GET /api/contacts/:cid/workflow-history — all workflow runs for a contact
  app.get(
    '/api/contacts/:cid/workflow-history',
    { preHandler: app.requireAuth },
    async (req) => {
      const { cid } = req.params as { cid: string };
      const q = req.query as Record<string, string>;
      const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
      const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
      const offset = (page - 1) * pageSize;

      const where = eq(workflowRuns.contactId, cid);

      const data = await app.db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.workflowId,
          workflowName: workflows.name,
          status: workflowRuns.status,
          startedAt: workflowRuns.startedAt,
          completedAt: workflowRuns.completedAt,
          errorMessage: workflowRuns.errorMessage,
        })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
        .where(where)
        .orderBy(desc(workflowRuns.startedAt))
        .limit(pageSize)
        .offset(offset);

      return { data };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // STEP CRUD
  // ═══════════════════════════════════════════════════════════════════════

  // POST /api/workflows/:id/steps
  app.post<{ Params: { id: string }; Body: { type: string; config: Record<string, unknown>; order: number; parentStepId?: string; branch?: string } }>(
    '/api/workflows/:id/steps',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params;
      const { type, config, order, parentStepId, branch } = req.body;

      const [existing] = await app.db
        .select({ id: workflows.id, status: workflows.status })
        .from(workflows)
        .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
        .limit(1);

      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const [step] = await app.db
        .insert(workflowSteps)
        .values({ workflowId: id, type: type as any, config, order, parentStepId: parentStepId ?? null, branch: branch ?? null })
        .returning();

      return reply.code(201).send(step);
    },
  );

  // PATCH /api/workflows/:id/steps/:stepId
  app.patch<{ Params: { id: string; stepId: string }; Body: { config?: Record<string, unknown>; order?: number } }>(
    '/api/workflows/:id/steps/:stepId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { stepId } = req.params;
      const { config, order } = req.body;

      const updates: Record<string, unknown> = {};
      if (config !== undefined) updates.config = config;
      if (order !== undefined) updates.order = order;

      const [step] = await app.db
        .update(workflowSteps)
        .set(updates as any)
        .where(eq(workflowSteps.id, stepId))
        .returning();

      if (!step) return reply.code(404).send({ error: 'not_found' });
      return reply.send(step);
    },
  );

  // DELETE /api/workflows/:id/steps/:stepId
  app.delete<{ Params: { id: string; stepId: string } }>(
    '/api/workflows/:id/steps/:stepId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { stepId } = req.params;
      await app.db.delete(workflowSteps).where(eq(workflowSteps.id, stepId));
      return reply.code(204).send();
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TEST MODE
  // ═══════════════════════════════════════════════════════════════════════

  // POST /api/workflows/:id/test — dry-run simulation
  app.post<{
    Params: { id: string };
    Body: { contactId: string };
  }>(
    '/api/workflows/:id/test',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params;
      const { contactId } = req.body;

      if (!contactId) return reply.code(400).send({ error: 'contactId_required' });

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

      const [contact] = await app.db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (!contact) return reply.code(404).send({ error: 'contact_not_found' });

      const contactRecord: Record<string, unknown> = {
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        phone: contact.phoneE164,
      };

      const { evaluateFilters } = await import('../services/workflow-filter.js');
      const filtersPassed = evaluateFilters(workflow.filters, contactRecord);

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

  // ═══════════════════════════════════════════════════════════════════════
  // STEP REORDER
  // ═══════════════════════════════════════════════════════════════════════

  // POST /api/workflows/:id/steps/reorder
  app.post<{
    Params: { id: string };
    Body: { steps: Array<{ id: string; order: number }> };
  }>(
    '/api/workflows/:id/steps/reorder',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { steps } = req.body;
      if (!Array.isArray(steps) || steps.length === 0) {
        return reply.code(400).send({ error: 'steps_required' });
      }

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
}

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
      return `Would wait until condition met (timeout: ${(config as Record<string, unknown>).timeoutDays} days)`;
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
