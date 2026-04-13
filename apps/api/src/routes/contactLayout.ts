import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { contactLayoutConfig } from '@crm/db';

export default async function contactLayoutRoutes(app: FastifyInstance) {
  // GET /api/contact-layout
  app.get(
    '/api/contact-layout',
    { preHandler: app.requireAuth },
    async () => {
      const [row] = await app.db
        .select()
        .from(contactLayoutConfig)
        .limit(1);

      return {
        groupOrder: row?.groupOrder ?? [],
        pinnedPropertyKeys: row?.pinnedPropertyKeys ?? [],
      };
    },
  );

  // PATCH /api/contact-layout
  app.patch(
    '/api/contact-layout',
    { preHandler: app.requireAuth },
    async (req) => {
      const body = req.body as {
        groupOrder?: string[];
        pinnedPropertyKeys?: string[];
      };

      const [existing] = await app.db
        .select()
        .from(contactLayoutConfig)
        .limit(1);

      if (existing) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (body.groupOrder !== undefined) updates['groupOrder'] = body.groupOrder;
        if (body.pinnedPropertyKeys !== undefined) updates['pinnedPropertyKeys'] = body.pinnedPropertyKeys;

        const [updated] = await app.db
          .update(contactLayoutConfig)
          .set(updates)
          .where(eq(contactLayoutConfig.id, existing.id))
          .returning();

        return {
          groupOrder: updated!.groupOrder,
          pinnedPropertyKeys: updated!.pinnedPropertyKeys,
        };
      }

      const [created] = await app.db
        .insert(contactLayoutConfig)
        .values({
          groupOrder: body.groupOrder ?? [],
          pinnedPropertyKeys: body.pinnedPropertyKeys ?? [],
        })
        .returning();

      return {
        groupOrder: created!.groupOrder,
        pinnedPropertyKeys: created!.pinnedPropertyKeys,
      };
    },
  );
}
