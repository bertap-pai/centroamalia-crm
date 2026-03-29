import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { pipelines, stages } from '@crm/db';

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
}
