import type { FastifyInstance } from 'fastify';
import { eq, and, or, asc } from 'drizzle-orm';
import { savedViews } from '@crm/db';

export default async function savedViewsRoutes(app: FastifyInstance) {
  // GET /api/saved-views?objectType=contact|deal
  app.get(
    '/api/saved-views',
    { preHandler: app.requireAuth },
    async (req) => {
      const { objectType } = req.query as { objectType?: 'contact' | 'deal' };

      const visibilityCond = or(
        eq(savedViews.isTeam, true),
        eq(savedViews.createdByUserId, req.user!.id),
      )!;

      const conditions: any[] = [visibilityCond];
      if (objectType) conditions.push(eq(savedViews.objectType, objectType));

      return app.db
        .select()
        .from(savedViews)
        .where(and(...conditions))
        .orderBy(asc(savedViews.isTeam), asc(savedViews.name));
    },
  );

  // POST /api/saved-views
  app.post(
    '/api/saved-views',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        objectType: 'contact' | 'deal';
        config: Record<string, unknown>;
        isTeam?: boolean;
      };

      if (!body.name || !body.objectType || !body.config) {
        return reply.code(400).send({ error: 'name, objectType and config are required' });
      }

      // Only admins can create team views
      const isTeam = Boolean(body.isTeam) && req.user!.role === 'admin';

      const [view] = await app.db
        .insert(savedViews)
        .values({
          name: body.name,
          objectType: body.objectType,
          config: body.config,
          isTeam,
          createdByUserId: req.user!.id,
        })
        .returning();

      return reply.code(201).send(view);
    },
  );

  // PATCH /api/saved-views/:id
  app.patch(
    '/api/saved-views/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; config?: Record<string, unknown> };

      const [existing] = await app.db
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const canEdit =
        existing.createdByUserId === req.user!.id ||
        (existing.isTeam && req.user!.role === 'admin');
      if (!canEdit) return reply.code(403).send({ error: 'forbidden' });

      const updates: Record<string, unknown> = {};
      if (body.name) updates['name'] = body.name;
      if (body.config) updates['config'] = body.config;

      if (Object.keys(updates).length === 0) return existing;

      const [updated] = await app.db
        .update(savedViews)
        .set(updates)
        .where(eq(savedViews.id, id))
        .returning();

      return updated;
    },
  );

  // DELETE /api/saved-views/:id
  app.delete(
    '/api/saved-views/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const [existing] = await app.db
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const canDelete =
        existing.createdByUserId === req.user!.id ||
        (existing.isTeam && req.user!.role === 'admin');
      if (!canDelete) return reply.code(403).send({ error: 'forbidden' });

      await app.db.delete(savedViews).where(eq(savedViews.id, id));
      return reply.code(204).send();
    },
  );
}
