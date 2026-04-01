import type { FastifyInstance } from 'fastify';
import { inArray, asc, eq, sql } from 'drizzle-orm';
import { propertyDefinitions, formFields } from '@crm/db';

export default async function propertiesRoutes(app: FastifyInstance) {
  // GET /api/properties?scope=contact|deal|both|all
  // scope=contact returns both 'contact' and 'both' scoped properties
  app.get(
    '/api/properties',
    { preHandler: app.requireAuth },
    async (req) => {
      const { scope } = req.query as { scope?: string };

      let scopes: ('contact' | 'deal' | 'both')[];
      if (!scope || scope === 'all') {
        scopes = ['contact', 'deal', 'both'];
      } else if (scope === 'contact') {
        scopes = ['contact', 'both'];
      } else if (scope === 'deal') {
        scopes = ['deal', 'both'];
      } else {
        scopes = [scope as 'contact' | 'deal' | 'both'];
      }

      return app.db
        .select()
        .from(propertyDefinitions)
        .where(inArray(propertyDefinitions.scope, scopes))
        .orderBy(asc(propertyDefinitions.position), asc(propertyDefinitions.createdAt));
    },
  );

  // POST /api/properties — admin only
  app.post(
    '/api/properties',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const body = req.body as {
        key: string;
        label: string;
        scope: 'contact' | 'deal' | 'both';
        type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
        options?: Array<{ key: string; label: string }>;
        isRequired?: boolean;
        isInternalOnly?: boolean;
        isSensitive?: boolean;
        position?: string;
        group?: string;
      };

      if (!body.key || !body.label || !body.scope || !body.type) {
        return reply.status(400).send({ error: 'key, label, scope and type are required' });
      }

      const [created] = await app.db
        .insert(propertyDefinitions)
        .values({
          key: body.key,
          label: body.label,
          scope: body.scope,
          type: body.type,
          options: body.options ?? [],
          isRequired: body.isRequired ?? false,
          isInternalOnly: body.isInternalOnly ?? false,
          isSensitive: body.isSensitive ?? false,
          position: body.position ?? '',
          group: body.group ?? null,
        })
        .returning();

      await app.audit({
        userId: req.user!.id,
        action: 'create',
        objectType: 'property_definition',
        objectId: created!.id,
        diff: { after: created as unknown as Record<string, unknown> },
      });

      return reply.status(201).send(created);
    },
  );

  // PATCH /api/properties/:id — admin only
  app.patch(
    '/api/properties/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        label?: string;
        scope?: 'contact' | 'deal' | 'both';
        type?: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
        options?: Array<{ key: string; label: string }>;
        isRequired?: boolean;
        isInternalOnly?: boolean;
        isSensitive?: boolean;
        position?: string;
        group?: string | null;
      };

      const existing = await app.db.query.propertyDefinitions.findFirst({
        where: eq(propertyDefinitions.id, id),
      });
      if (!existing) return reply.status(404).send({ error: 'Not found' });

      const updates: Partial<typeof propertyDefinitions.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.label !== undefined) updates.label = body.label;
      if (body.scope !== undefined) updates.scope = body.scope;
      if (body.type !== undefined) updates.type = body.type;
      if (body.options !== undefined) updates.options = body.options;
      if (body.isRequired !== undefined) updates.isRequired = body.isRequired;
      if (body.isInternalOnly !== undefined) updates.isInternalOnly = body.isInternalOnly;
      if (body.isSensitive !== undefined) updates.isSensitive = body.isSensitive;
      if (body.position !== undefined) updates.position = body.position;
      if (body.group !== undefined) updates.group = body.group;

      const [updated] = await app.db
        .update(propertyDefinitions)
        .set(updates)
        .where(eq(propertyDefinitions.id, id))
        .returning();

      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'property_definition',
        objectId: id,
        diff: {
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
        },
      });

      return updated;
    },
  );

  // DELETE /api/properties/:id — admin only
  app.delete(
    '/api/properties/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const existing = await app.db.query.propertyDefinitions.findFirst({
        where: eq(propertyDefinitions.id, id),
      });
      if (!existing) return reply.status(404).send({ error: 'Not found' });

      // Guard: check pipeline stage required_fields
      const stageRefs = await app.db.execute<{ id: string; name: string }>(
        sql`SELECT id, name FROM pipeline_stages
            WHERE required_fields @> ${JSON.stringify([existing.key])}::jsonb`,
      );

      // Guard: check form fields
      const formRefs = await app.db
        .select({ id: formFields.id, label: formFields.label })
        .from(formFields)
        .where(eq(formFields.crmPropertyKey, existing.key));

      const usedIn: string[] = [
        ...Array.from(stageRefs).map((r) => `pipeline stage "${r.name}"`),
        ...formRefs.map((r) => `form field "${r.label ?? r.id}"`),
      ];

      if (usedIn.length > 0) {
        return reply.status(409).send({
          error: `Cannot delete property "${existing.key}" because it is in use: ${usedIn.join(', ')}.`,
        });
      }

      await app.db.delete(propertyDefinitions).where(eq(propertyDefinitions.id, id));

      await app.audit({
        userId: req.user!.id,
        action: 'delete',
        objectType: 'property_definition',
        objectId: id,
        diff: { before: existing as unknown as Record<string, unknown> },
      });

      return reply.status(204).send();
    },
  );
}
