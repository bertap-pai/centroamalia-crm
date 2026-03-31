import type { FastifyInstance } from 'fastify';
import { asc, eq, ne } from 'drizzle-orm';
import { users } from '@crm/db';

export default async function usersRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get(
    '/api/admin/users',
    { preHandler: app.requireAdmin },
    async () => {
      return app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.name));
    },
  );

  // --------------------------------------------------------------- update role
  app.patch(
    '/api/admin/users/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { role?: 'admin' | 'user' };

      if (!body.role || !['admin', 'user'].includes(body.role)) {
        return reply.code(400).send({ error: 'role must be "admin" or "user"' });
      }

      // Prevent an admin from demoting themselves
      if (id === req.user!.id && body.role === 'user') {
        return reply.code(400).send({ error: 'cannot_demote_self' });
      }

      const [existing] = await app.db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const [updated] = await app.db
        .update(users)
        .set({ role: body.role, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();

      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'user' as any,
        objectId: id,
        diff: {
          before: { role: existing.role } as Record<string, unknown>,
          after: { role: updated!.role } as Record<string, unknown>,
        },
      });

      return updated;
    },
  );
}
