import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { users } from '@crm/db';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const user = await req.server.db.query.users.findFirst({
    where: eq(users.id, req.session.userId),
  });
  if (!user) {
    req.session.destroy((err) => {
      if (err) req.log.warn({ err }, 'session destroy error');
    });
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  req.user = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
}
