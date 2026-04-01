import type { FastifyInstance } from 'fastify';
import { asc, eq, count } from 'drizzle-orm';
import { pipelines, stages, deals } from '@crm/db';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function pipelinesRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get(
    '/api/pipelines',
    { preHandler: app.requireAuth },
    async () => {
      const pipelineRows = await app.db
        .select()
        .from(pipelines)
        .orderBy(asc(pipelines.position), asc(pipelines.createdAt));

      const stageRows = await app.db
        .select()
        .from(stages)
        .orderBy(asc(stages.pipelineId), asc(stages.position), asc(stages.createdAt));

      return pipelineRows.map((p) => ({
        ...p,
        stages: stageRows.filter((s) => s.pipelineId === p.id),
      }));
    },
  );

  // ----------------------------------------------------------------- single
  app.get(
    '/api/pipelines/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const [pipeline] = await app.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, id))
        .limit(1);
      if (!pipeline) return reply.code(404).send({ error: 'not_found' });

      const stageRows = await app.db
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, id))
        .orderBy(asc(stages.position), asc(stages.createdAt));

      return { ...pipeline, stages: stageRows };
    },
  );

  // ----------------------------------------------------------------- create
  app.post(
    '/api/pipelines',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const body = req.body as { name: string; slug?: string; position?: number };
      if (!body.name?.trim()) {
        return reply.code(400).send({ error: 'name is required' });
      }

      const slug = body.slug?.trim() || toSlug(body.name);

      const [created] = await app.db
        .insert(pipelines)
        .values({
          name: body.name.trim(),
          slug,
          position: body.position ?? 0,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  // ----------------------------------------------------------------- update
  app.patch(
    '/api/pipelines/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; position?: number; defaultView?: string };

      const [existing] = await app.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const updates: Partial<typeof pipelines.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.position !== undefined) updates.position = body.position;
      if (body.defaultView === 'list' || body.defaultView === 'kanban') updates.defaultView = body.defaultView;

      const [updated] = await app.db
        .update(pipelines)
        .set(updates)
        .where(eq(pipelines.id, id))
        .returning();

      return updated;
    },
  );

  // ----------------------------------------------------------------- delete
  app.delete(
    '/api/pipelines/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const [dealCount] = await app.db
        .select({ n: count() })
        .from(deals)
        .where(eq(deals.pipelineId, id));
      if ((dealCount?.n ?? 0) > 0) {
        return reply.code(409).send({ error: 'pipeline_has_deals', count: dealCount?.n });
      }

      // Delete stages first (FK constraint)
      await app.db.delete(stages).where(eq(stages.pipelineId, id));
      await app.db.delete(pipelines).where(eq(pipelines.id, id));

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------- create stage
  app.post(
    '/api/pipelines/:pipelineId/stages',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { pipelineId } = req.params as { pipelineId: string };
      const body = req.body as {
        name: string;
        slug?: string;
        position?: number;
        isClosedWon?: boolean;
        isClosedLost?: boolean;
      };

      if (!body.name?.trim()) {
        return reply.code(400).send({ error: 'name is required' });
      }

      const [pipeline] = await app.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);
      if (!pipeline) return reply.code(404).send({ error: 'pipeline_not_found' });

      const slug = body.slug?.trim() || toSlug(body.name);

      const [created] = await app.db
        .insert(stages)
        .values({
          pipelineId,
          name: body.name.trim(),
          slug,
          position: body.position ?? 0,
          isClosedWon: body.isClosedWon ?? false,
          isClosedLost: body.isClosedLost ?? false,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  // -------------------------------------------------------------- update stage
  app.patch(
    '/api/pipelines/:pipelineId/stages/:stageId',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { pipelineId, stageId } = req.params as { pipelineId: string; stageId: string };
      const body = req.body as {
        name?: string;
        position?: number;
        isClosedWon?: boolean;
        isClosedLost?: boolean;
        requiredFields?: string[];
      };

      const [existing] = await app.db
        .select()
        .from(stages)
        .where(eq(stages.id, stageId))
        .limit(1);
      if (!existing || existing.pipelineId !== pipelineId) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const updates: Partial<typeof stages.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.position !== undefined) updates.position = body.position;
      if (body.isClosedWon !== undefined) updates.isClosedWon = body.isClosedWon;
      if (body.isClosedLost !== undefined) updates.isClosedLost = body.isClosedLost;
      if (body.requiredFields !== undefined) updates.requiredFields = body.requiredFields;

      const [updated] = await app.db
        .update(stages)
        .set(updates)
        .where(eq(stages.id, stageId))
        .returning();

      return updated;
    },
  );

  // -------------------------------------------------------------- delete stage
  app.delete(
    '/api/pipelines/:pipelineId/stages/:stageId',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { pipelineId, stageId } = req.params as { pipelineId: string; stageId: string };

      const [existing] = await app.db
        .select()
        .from(stages)
        .where(eq(stages.id, stageId))
        .limit(1);
      if (!existing || existing.pipelineId !== pipelineId) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const [dealCount] = await app.db
        .select({ n: count() })
        .from(deals)
        .where(eq(deals.stageId, stageId));
      if ((dealCount?.n ?? 0) > 0) {
        return reply.code(409).send({ error: 'stage_has_deals', count: dealCount?.n });
      }

      await app.db.delete(stages).where(eq(stages.id, stageId));
      return reply.code(204).send();
    },
  );
}
