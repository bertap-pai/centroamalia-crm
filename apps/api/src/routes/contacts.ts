import type { FastifyInstance } from 'fastify';
import {
  eq,
  and,
  or,
  ilike,
  isNull,
  isNotNull,
  gte,
  lte,
  desc,
  asc,
  count,
  inArray,
  sql,
} from 'drizzle-orm';
import {
  contacts,
  contactPropertyValues,
  propertyDefinitions,
  deals,
  dealContacts,
  pipelines,
  stages,
  users,
} from '@crm/db';
import { normalizePhone } from '../lib/phone.js';

export default async function contactsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get(
    '/api/contacts',
    { preHandler: app.requireAuth },
    async (req) => {
      const q = req.query as Record<string, string>;

      const search = q['q'] ?? '';
      const includeArchived = q['includeArchived'] === 'true';
      const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
      const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
      const offset = (page - 1) * pageSize;
      const columns = q['columns'] ? q['columns'].split(',').filter(Boolean) : [];
      const createdFrom = q['createdFrom'];
      const createdTo = q['createdTo'];

      // Parse property filters: filter[key]=value
      const propFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(q)) {
        const m = k.match(/^filter\[(.+)\]$/);
        if (m?.[1]) propFilters[m[1]] = v;
      }

      // Build WHERE
      const conditions: ReturnType<typeof eq>[] = [];
      if (!includeArchived) conditions.push(isNull(contacts.archivedAt) as any);
      if (createdFrom) conditions.push(gte(contacts.createdAt, new Date(createdFrom)) as any);
      if (createdTo) conditions.push(lte(contacts.createdAt, new Date(createdTo)) as any);
      if (search) {
        const like = `%${search}%`;
        conditions.push(
          or(
            ilike(contacts.firstName, like),
            ilike(contacts.lastName, like),
            ilike(contacts.email, like),
            ilike(contacts.phoneE164, like),
          ) as any,
        );
      }
      for (const [key, val] of Object.entries(propFilters)) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM contact_property_values cpv
            JOIN property_definitions pd ON cpv.property_definition_id = pd.id
            WHERE cpv.contact_id = ${contacts.id} AND pd.key = ${key} AND cpv.value = ${val}
          )` as any,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Sort
      const baseFields: Record<string, any> = {
        created_at: contacts.createdAt,
        updated_at: contacts.updatedAt,
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        email: contacts.email,
        phone_e164: contacts.phoneE164,
      };
      const sortCol = q['sort'] && baseFields[q['sort']] ? baseFields[q['sort']] : contacts.createdAt;
      const orderBy = q['sortDir'] === 'asc' ? asc(sortCol) : desc(sortCol);

      // Count
      const countRows = await app.db.select({ total: count() }).from(contacts).where(where);
      const total = countRows[0]?.total ?? 0;

      // Rows
      const rows = await app.db
        .select()
        .from(contacts)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset);

      // Property values for requested columns
      const propertiesByContact: Record<string, Record<string, string>> = {};
      if (rows.length > 0 && columns.length > 0) {
        const ids = rows.map((r) => r.id);
        const pvRows = await app.db
          .select({
            contactId: contactPropertyValues.contactId,
            key: propertyDefinitions.key,
            value: contactPropertyValues.value,
          })
          .from(contactPropertyValues)
          .innerJoin(
            propertyDefinitions,
            eq(contactPropertyValues.propertyDefinitionId, propertyDefinitions.id),
          )
          .where(
            and(
              inArray(contactPropertyValues.contactId, ids),
              inArray(propertyDefinitions.key, columns),
            ),
          );
        for (const pv of pvRows) {
          if (!propertiesByContact[pv.contactId]) propertiesByContact[pv.contactId] = {};
          propertiesByContact[pv.contactId]![pv.key] = pv.value ?? '';
        }
      }

      return {
        data: rows.map((c) => ({ ...c, properties: propertiesByContact[c.id] ?? {} })),
        total: Number(total ?? 0),
        page,
        pageSize,
      };
    },
  );

  // ---------------------------------------------------------------- create
  app.post(
    '/api/contacts',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const body = req.body as {
        phone: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        properties?: Record<string, string>;
      };

      if (!body.phone) return reply.code(400).send({ error: 'phone_required' });

      const phoneE164 = normalizePhone(body.phone);
      if (!phoneE164) {
        return reply.code(400).send({
          error: 'invalid_phone',
          message: 'El telèfon no és vàlid o no es pot normalitzar a E.164.',
        });
      }

      // Dedup check
      const [dup] = await app.db
        .select()
        .from(contacts)
        .where(eq(contacts.phoneE164, phoneE164))
        .limit(1);
      if (dup) {
        return reply.code(409).send({ error: 'duplicate_phone', existing: dup });
      }

      const [contact] = await app.db
        .insert(contacts)
        .values({
          phoneE164,
          firstName: body.firstName || null,
          lastName: body.lastName || null,
          email: body.email || null,
          createdByUserId: req.user!.id,
        })
        .returning();

      if (!contact) return reply.code(500).send({ error: 'insert_failed' });

      // Dynamic properties
      if (body.properties && Object.keys(body.properties).length > 0) {
        const propDefs = await app.db
          .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
          .from(propertyDefinitions)
          .where(inArray(propertyDefinitions.key, Object.keys(body.properties)));

        for (const pd of propDefs) {
          const val = body.properties[pd.key];
          if (val) {
            await app.db
              .insert(contactPropertyValues)
              .values({ contactId: contact.id, propertyDefinitionId: pd.id, value: val })
              .onConflictDoUpdate({
                target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
                set: { value: val, updatedAt: new Date() },
              });
          }
        }
      }

      await app.audit({
        userId: req.user!.id,
        action: 'create',
        objectType: 'contact',
        objectId: contact.id,
        diff: { after: { phoneE164, firstName: body.firstName, lastName: body.lastName, email: body.email } },
      });

      (req as any).__responseBody = contact;
      return reply.code(201).send(contact);
    },
  );

  // ----------------------------------------------------------------- detail
  app.get(
    '/api/contacts/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const [contact] = await app.db
        .select()
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);
      if (!contact) return reply.code(404).send({ error: 'not_found' });

      // All property values
      const pvRows = await app.db
        .select({
          key: propertyDefinitions.key,
          value: contactPropertyValues.value,
          label: propertyDefinitions.label,
          type: propertyDefinitions.type,
          options: propertyDefinitions.options,
          isSensitive: propertyDefinitions.isSensitive,
        })
        .from(contactPropertyValues)
        .innerJoin(
          propertyDefinitions,
          eq(contactPropertyValues.propertyDefinitionId, propertyDefinitions.id),
        )
        .where(eq(contactPropertyValues.contactId, id));

      const properties: Record<string, string> = {};
      for (const pv of pvRows) properties[pv.key] = pv.value ?? '';

      // Linked deals
      const linkedDeals = await app.db
        .select({
          dealId: deals.id,
          isPrimary: dealContacts.isPrimary,
          role: dealContacts.role,
          pipelineName: pipelines.name,
          pipelineSlug: pipelines.slug,
          stageId: deals.stageId,
          stageName: stages.name,
          stageSlug: stages.slug,
          isClosedWon: deals.isClosedWon,
          isClosedLost: deals.isClosedLost,
          ownerUserId: deals.ownerUserId,
          createdAt: deals.createdAt,
          archivedAt: deals.archivedAt,
        })
        .from(dealContacts)
        .innerJoin(deals, eq(dealContacts.dealId, deals.id))
        .innerJoin(pipelines, eq(deals.pipelineId, pipelines.id))
        .innerJoin(stages, eq(deals.stageId, stages.id))
        .where(eq(dealContacts.contactId, id))
        .orderBy(desc(deals.createdAt));

      // Owner names for deals
      const ownerIds = [...new Set(linkedDeals.flatMap((d) => d.ownerUserId ? [d.ownerUserId] : []))];
      const ownerMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const ownerRows = await app.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ownerIds));
        for (const o of ownerRows) ownerMap[o.id] = o.name ?? o.id;
      }

      return {
        ...contact,
        properties,
        deals: linkedDeals.map((d) => ({
          ...d,
          ownerName: d.ownerUserId ? (ownerMap[d.ownerUserId] ?? null) : null,
        })),
      };
    },
  );

  // ----------------------------------------------------------------- update
  app.patch(
    '/api/contacts/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        properties?: Record<string, string>;
      };

      const [existing] = await app.db
        .select()
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const updates: Record<string, any> = {};
      if (body.firstName !== undefined) updates['firstName'] = body.firstName || null;
      if (body.lastName !== undefined) updates['lastName'] = body.lastName || null;
      if (body.email !== undefined) updates['email'] = body.email || null;

      if (body.phone !== undefined) {
        const phoneE164 = normalizePhone(body.phone);
        if (!phoneE164) return reply.code(400).send({ error: 'invalid_phone' });
        if (phoneE164 !== existing.phoneE164) {
          const [dup] = await app.db
            .select()
            .from(contacts)
            .where(eq(contacts.phoneE164, phoneE164))
            .limit(1);
          if (dup) return reply.code(409).send({ error: 'duplicate_phone', existing: dup });
        }
        updates['phoneE164'] = phoneE164;
      }

      let updated = existing;
      if (Object.keys(updates).length > 0) {
        const [u] = await app.db
          .update(contacts)
          .set(updates)
          .where(eq(contacts.id, id))
          .returning();
        if (u) updated = u;
      }

      // Dynamic properties
      if (body.properties && Object.keys(body.properties).length > 0) {
        const propDefs = await app.db
          .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
          .from(propertyDefinitions)
          .where(inArray(propertyDefinitions.key, Object.keys(body.properties)));

        for (const pd of propDefs) {
          const val = body.properties[pd.key];
          if (val === undefined) continue;
          if (val === '') {
            await app.db
              .delete(contactPropertyValues)
              .where(
                and(
                  eq(contactPropertyValues.contactId, id),
                  eq(contactPropertyValues.propertyDefinitionId, pd.id),
                ),
              );
          } else {
            await app.db
              .insert(contactPropertyValues)
              .values({ contactId: id, propertyDefinitionId: pd.id, value: val })
              .onConflictDoUpdate({
                target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
                set: { value: val, updatedAt: new Date() },
              });
          }
        }
      }

      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'contact',
        objectId: id,
        diff: {
          before: { firstName: existing.firstName, lastName: existing.lastName, phoneE164: existing.phoneE164 },
          after: updates,
        },
      });

      return updated;
    },
  );

  // --------------------------------------------------------------- archive
  app.post(
    '/api/contacts/:id/archive',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [contact] = await app.db
        .update(contacts)
        .set({ archivedAt: new Date(), archivedByUserId: req.user!.id })
        .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
        .returning();
      if (!contact) return reply.code(404).send({ error: 'not_found_or_already_archived' });
      await app.audit({ userId: req.user!.id, action: 'archive', objectType: 'contact', objectId: id });
      return contact;
    },
  );

  // --------------------------------------------------------------- restore
  app.post(
    '/api/contacts/:id/restore',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [contact] = await app.db
        .update(contacts)
        .set({ archivedAt: null, archivedByUserId: null })
        .where(and(eq(contacts.id, id), isNotNull(contacts.archivedAt)))
        .returning();
      if (!contact) return reply.code(404).send({ error: 'not_found_or_not_archived' });
      await app.audit({ userId: req.user!.id, action: 'restore', objectType: 'contact', objectId: id });
      return contact;
    },
  );
}
