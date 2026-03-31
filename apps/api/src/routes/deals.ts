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
  deals,
  dealContacts,
  dealStageEvents,
  dealPropertyValues,
  propertyDefinitions,
  pipelines,
  stages,
  contacts,
  users,
} from '@crm/db';

export default async function dealsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get(
    '/api/deals',
    { preHandler: app.requireAuth },
    async (req) => {
      const q = req.query as Record<string, string>;

      const search = q['q'] ?? '';
      const includeArchived = q['includeArchived'] === 'true';
      const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
      const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
      const offset = (page - 1) * pageSize;
      const columns = q['columns'] ? q['columns'].split(',').filter(Boolean) : [];
      const filterPipelineId = q['pipelineId'];
      const filterStageId = q['stageId'];
      const filterOwnerUserId = q['ownerUserId'];
      const createdFrom = q['createdFrom'];
      const createdTo = q['createdTo'];

      const propFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(q)) {
        const m = k.match(/^filter\[(.+)\]$/);
        if (m?.[1]) propFilters[m[1]] = v;
      }

      const conditions: any[] = [];
      if (!includeArchived) conditions.push(isNull(deals.archivedAt));
      if (filterPipelineId) conditions.push(eq(deals.pipelineId, filterPipelineId));
      if (filterStageId) conditions.push(eq(deals.stageId, filterStageId));
      if (filterOwnerUserId) conditions.push(eq(deals.ownerUserId, filterOwnerUserId));
      if (createdFrom) conditions.push(gte(deals.createdAt, new Date(createdFrom)));
      if (createdTo) conditions.push(lte(deals.createdAt, new Date(createdTo)));

      if (search) {
        const like = `%${search}%`;
        conditions.push(
          or(
            sql`EXISTS (
              SELECT 1 FROM deal_contacts dc2
              JOIN contacts c2 ON dc2.contact_id = c2.id
              WHERE dc2.deal_id = ${deals.id} AND dc2.is_primary = true
              AND (c2.first_name ILIKE ${like} OR c2.last_name ILIKE ${like} OR c2.phone_e164 ILIKE ${like} OR c2.email ILIKE ${like})
            )`,
          ) as any,
        );
      }

      for (const [key, val] of Object.entries(propFilters)) {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM deal_property_values dpv
            JOIN property_definitions pd ON dpv.property_definition_id = pd.id
            WHERE dpv.deal_id = ${deals.id} AND pd.key = ${key} AND dpv.value = ${val}
          )` as any,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const baseFields: Record<string, any> = {
        created_at: deals.createdAt,
        updated_at: deals.updatedAt,
        current_stage_entered_at: deals.currentStageEnteredAt,
      };
      const sortCol = q['sort'] && baseFields[q['sort']] ? baseFields[q['sort']] : deals.createdAt;
      const orderBy = q['sortDir'] === 'asc' ? asc(sortCol) : desc(sortCol);

      const [countRow] = await app.db.select({ total: count() }).from(deals).where(where);
      const total = countRow?.total ?? 0;

      const rows = await app.db
        .select()
        .from(deals)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset);

      if (rows.length === 0) {
        return { data: [], total: Number(total), page, pageSize };
      }

      const ids = rows.map((r) => r.id);

      // Primary contacts for each deal
      const primaryContacts = await app.db
        .select({
          dealId: dealContacts.dealId,
          contactId: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          phoneE164: contacts.phoneE164,
          email: contacts.email,
        })
        .from(dealContacts)
        .innerJoin(contacts, eq(dealContacts.contactId, contacts.id))
        .where(and(inArray(dealContacts.dealId, ids), eq(dealContacts.isPrimary, true)));

      const primaryContactByDeal: Record<string, typeof primaryContacts[0]> = {};
      for (const pc of primaryContacts) primaryContactByDeal[pc.dealId] = pc;

      // Pipeline + stage names
      const pipelineIds = [...new Set(rows.map((r) => r.pipelineId))];
      const stageIds = [...new Set(rows.map((r) => r.stageId))];

      const pipelineRows = await app.db
        .select({ id: pipelines.id, name: pipelines.name, slug: pipelines.slug })
        .from(pipelines)
        .where(inArray(pipelines.id, pipelineIds));
      const pipelineMap: Record<string, { name: string; slug: string }> = {};
      for (const p of pipelineRows) pipelineMap[p.id] = { name: p.name, slug: p.slug };

      const stageRows = await app.db
        .select({ id: stages.id, name: stages.name, slug: stages.slug })
        .from(stages)
        .where(inArray(stages.id, stageIds));
      const stageMap: Record<string, { name: string; slug: string }> = {};
      for (const s of stageRows) stageMap[s.id] = { name: s.name, slug: s.slug };

      // Owner names
      const ownerIds = [...new Set(rows.flatMap((r) => r.ownerUserId ? [r.ownerUserId] : []))];
      const ownerMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const ownerRows = await app.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ownerIds));
        for (const o of ownerRows) ownerMap[o.id] = o.name ?? o.id;
      }

      // Dynamic property values
      const propertiesByDeal: Record<string, Record<string, string>> = {};
      if (columns.length > 0) {
        const pvRows = await app.db
          .select({
            dealId: dealPropertyValues.dealId,
            key: propertyDefinitions.key,
            value: dealPropertyValues.value,
          })
          .from(dealPropertyValues)
          .innerJoin(propertyDefinitions, eq(dealPropertyValues.propertyDefinitionId, propertyDefinitions.id))
          .where(
            and(
              inArray(dealPropertyValues.dealId, ids),
              inArray(propertyDefinitions.key, columns),
            ),
          );
        for (const pv of pvRows) {
          if (!propertiesByDeal[pv.dealId]) propertiesByDeal[pv.dealId] = {};
          propertiesByDeal[pv.dealId]![pv.key] = pv.value ?? '';
        }
      }

      return {
        data: rows.map((d) => ({
          ...d,
          primaryContact: primaryContactByDeal[d.id] ?? null,
          pipelineName: pipelineMap[d.pipelineId]?.name ?? null,
          pipelineSlug: pipelineMap[d.pipelineId]?.slug ?? null,
          stageName: stageMap[d.stageId]?.name ?? null,
          stageSlug: stageMap[d.stageId]?.slug ?? null,
          ownerName: d.ownerUserId ? (ownerMap[d.ownerUserId] ?? null) : null,
          properties: propertiesByDeal[d.id] ?? {},
        })),
        total: Number(total),
        page,
        pageSize,
      };
    },
  );

  // --------------------------------------------------------------- kanban
  app.get(
    '/api/deals/kanban',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const q = req.query as Record<string, string>;
      const pipelineId = q['pipelineId'];
      if (!pipelineId) return reply.code(400).send({ error: 'pipelineId_required' });

      const includeArchived = q['includeArchived'] === 'true';

      const [pipeline] = await app.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);
      if (!pipeline) return reply.code(404).send({ error: 'pipeline_not_found' });

      const stageRows = await app.db
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, pipelineId))
        .orderBy(asc(stages.position), asc(stages.createdAt));

      const conditions: any[] = [eq(deals.pipelineId, pipelineId)];
      if (!includeArchived) conditions.push(isNull(deals.archivedAt));

      const dealRows = await app.db
        .select()
        .from(deals)
        .where(and(...conditions))
        .orderBy(asc(deals.currentStageEnteredAt));

      if (dealRows.length === 0) {
        return {
          pipeline,
          stages: stageRows.map((s) => ({ ...s, deals: [] })),
        };
      }

      const dealIds = dealRows.map((d) => d.id);

      // Primary contacts
      const primaryContacts = await app.db
        .select({
          dealId: dealContacts.dealId,
          contactId: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          phoneE164: contacts.phoneE164,
        })
        .from(dealContacts)
        .innerJoin(contacts, eq(dealContacts.contactId, contacts.id))
        .where(and(inArray(dealContacts.dealId, dealIds), eq(dealContacts.isPrimary, true)));

      const primaryContactByDeal: Record<string, typeof primaryContacts[0]> = {};
      for (const pc of primaryContacts) primaryContactByDeal[pc.dealId] = pc;

      // Owner names
      const ownerIds = [...new Set(dealRows.flatMap((d) => d.ownerUserId ? [d.ownerUserId] : []))];
      const ownerMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const ownerRows = await app.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ownerIds));
        for (const o of ownerRows) ownerMap[o.id] = o.name ?? o.id;
      }

      const dealsByStage: Record<string, typeof dealRows> = {};
      for (const d of dealRows) {
        if (!dealsByStage[d.stageId]) dealsByStage[d.stageId] = [];
        dealsByStage[d.stageId]!.push(d);
      }

      return {
        pipeline,
        stages: stageRows.map((s) => ({
          ...s,
          deals: (dealsByStage[s.id] ?? []).map((d) => ({
            ...d,
            primaryContact: primaryContactByDeal[d.id] ?? null,
            ownerName: d.ownerUserId ? (ownerMap[d.ownerUserId] ?? null) : null,
          })),
        })),
      };
    },
  );

  // ---------------------------------------------------------------- create
  app.post(
    '/api/deals',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const body = req.body as {
        pipelineId: string;
        stageId: string;
        ownerUserId?: string;
        primaryContactId: string;
        properties?: Record<string, string>;
      };

      if (!body.pipelineId) return reply.code(400).send({ error: 'pipelineId_required' });
      if (!body.stageId) return reply.code(400).send({ error: 'stageId_required' });
      if (!body.primaryContactId) return reply.code(400).send({ error: 'primaryContactId_required' });

      // Verify stage belongs to pipeline
      const [stage] = await app.db
        .select()
        .from(stages)
        .where(and(eq(stages.id, body.stageId), eq(stages.pipelineId, body.pipelineId)))
        .limit(1);
      if (!stage) return reply.code(400).send({ error: 'stage_not_in_pipeline' });

      // Verify contact exists
      const [contact] = await app.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, body.primaryContactId))
        .limit(1);
      if (!contact) return reply.code(400).send({ error: 'contact_not_found' });

      const now = new Date();
      const [deal] = await app.db
        .insert(deals)
        .values({
          pipelineId: body.pipelineId,
          stageId: body.stageId,
          ownerUserId: body.ownerUserId ?? null,
          isClosedWon: stage.isClosedWon,
          isClosedLost: stage.isClosedLost,
          currentStageEnteredAt: now,
          createdByUserId: req.user!.id,
        })
        .returning();

      if (!deal) return reply.code(500).send({ error: 'insert_failed' });

      // Primary contact link
      await app.db.insert(dealContacts).values({
        dealId: deal.id,
        contactId: body.primaryContactId,
        isPrimary: true,
        role: null,
      });

      // Initial stage event
      await app.db.insert(dealStageEvents).values({
        dealId: deal.id,
        pipelineId: body.pipelineId,
        fromStageId: null,
        toStageId: body.stageId,
        changedAt: now,
        changedByUserId: req.user!.id,
        source: 'ui',
      });

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
              .insert(dealPropertyValues)
              .values({ dealId: deal.id, propertyDefinitionId: pd.id, value: val })
              .onConflictDoUpdate({
                target: [dealPropertyValues.dealId, dealPropertyValues.propertyDefinitionId],
                set: { value: val, updatedAt: new Date() },
              });
          }
        }
      }

      await app.audit({
        userId: req.user!.id,
        action: 'create',
        objectType: 'deal',
        objectId: deal.id,
        diff: { after: { pipelineId: body.pipelineId, stageId: body.stageId, ownerUserId: body.ownerUserId } },
      });

      return reply.code(201).send(deal);
    },
  );

  // ----------------------------------------------------------------- detail
  app.get(
    '/api/deals/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const [deal] = await app.db
        .select()
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      if (!deal) return reply.code(404).send({ error: 'not_found' });

      // Pipeline + stage
      const [pipeline] = await app.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, deal.pipelineId))
        .limit(1);

      const allStages = await app.db
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, deal.pipelineId))
        .orderBy(asc(stages.position));

      const currentStage = allStages.find((s) => s.id === deal.stageId) ?? null;

      // Owner
      let ownerName: string | null = null;
      if (deal.ownerUserId) {
        const [owner] = await app.db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, deal.ownerUserId))
          .limit(1);
        ownerName = owner?.name ?? owner?.email ?? null;
      }

      // All property values
      const pvRows = await app.db
        .select({
          key: propertyDefinitions.key,
          value: dealPropertyValues.value,
          label: propertyDefinitions.label,
          type: propertyDefinitions.type,
          options: propertyDefinitions.options,
          isSensitive: propertyDefinitions.isSensitive,
        })
        .from(dealPropertyValues)
        .innerJoin(propertyDefinitions, eq(dealPropertyValues.propertyDefinitionId, propertyDefinitions.id))
        .where(eq(dealPropertyValues.dealId, id));

      const properties: Record<string, string> = {};
      for (const pv of pvRows) properties[pv.key] = pv.value ?? '';

      // Linked contacts
      const contactRows = await app.db
        .select({
          contactId: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          phoneE164: contacts.phoneE164,
          email: contacts.email,
          isPrimary: dealContacts.isPrimary,
          role: dealContacts.role,
          archivedAt: contacts.archivedAt,
        })
        .from(dealContacts)
        .innerJoin(contacts, eq(dealContacts.contactId, contacts.id))
        .where(eq(dealContacts.dealId, id))
        .orderBy(desc(dealContacts.isPrimary));

      // Stage history
      const historyRows = await app.db
        .select({
          id: dealStageEvents.id,
          fromStageId: dealStageEvents.fromStageId,
          toStageId: dealStageEvents.toStageId,
          changedAt: dealStageEvents.changedAt,
          changedByUserId: dealStageEvents.changedByUserId,
          source: dealStageEvents.source,
        })
        .from(dealStageEvents)
        .where(eq(dealStageEvents.dealId, id))
        .orderBy(asc(dealStageEvents.changedAt));

      // Enrich stage history with names
      const allStageMap: Record<string, string> = {};
      for (const s of allStages) allStageMap[s.id] = s.name;

      const historyUserIds = [...new Set(historyRows.flatMap((h) => h.changedByUserId ? [h.changedByUserId] : []))];
      const historyUserMap: Record<string, string> = {};
      if (historyUserIds.length > 0) {
        const historyUsers = await app.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, historyUserIds));
        for (const u of historyUsers) historyUserMap[u.id] = u.name ?? u.id;
      }

      return {
        ...deal,
        pipeline,
        stages: allStages,
        currentStage,
        ownerName,
        properties,
        contacts: contactRows,
        stageHistory: historyRows.map((h) => ({
          ...h,
          fromStageName: h.fromStageId ? (allStageMap[h.fromStageId] ?? null) : null,
          toStageName: allStageMap[h.toStageId] ?? null,
          changedByName: h.changedByUserId ? (historyUserMap[h.changedByUserId] ?? null) : null,
        })),
      };
    },
  );

  // ----------------------------------------------------------------- update
  app.patch(
    '/api/deals/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        ownerUserId?: string | null;
        properties?: Record<string, string>;
      };

      const [existing] = await app.db
        .select()
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const updates: Record<string, any> = {};
      if ('ownerUserId' in body) updates['ownerUserId'] = body.ownerUserId ?? null;

      let updated = existing;
      if (Object.keys(updates).length > 0) {
        const [u] = await app.db
          .update(deals)
          .set(updates)
          .where(eq(deals.id, id))
          .returning();
        if (u) updated = u;
      }

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
              .delete(dealPropertyValues)
              .where(
                and(
                  eq(dealPropertyValues.dealId, id),
                  eq(dealPropertyValues.propertyDefinitionId, pd.id),
                ),
              );
          } else {
            await app.db
              .insert(dealPropertyValues)
              .values({ dealId: id, propertyDefinitionId: pd.id, value: val })
              .onConflictDoUpdate({
                target: [dealPropertyValues.dealId, dealPropertyValues.propertyDefinitionId],
                set: { value: val, updatedAt: new Date() },
              });
          }
        }
      }

      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'deal',
        objectId: id,
        diff: { before: { ownerUserId: existing.ownerUserId }, after: updates },
      });

      return updated;
    },
  );

  // ------------------------------------------------------- move stage
  app.post(
    '/api/deals/:id/stage',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { stageId: string };

      if (!body.stageId) return reply.code(400).send({ error: 'stageId_required' });

      const [deal] = await app.db
        .select()
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      if (!deal) return reply.code(404).send({ error: 'not_found' });

      const [targetStage] = await app.db
        .select()
        .from(stages)
        .where(and(eq(stages.id, body.stageId), eq(stages.pipelineId, deal.pipelineId)))
        .limit(1);
      if (!targetStage) return reply.code(400).send({ error: 'stage_not_in_pipeline' });

      // Stage validation: check required fields
      const requiredFields = (targetStage.requiredFields as string[]) ?? [];
      if (requiredFields.length > 0) {
        const propDefs = await app.db
          .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
          .from(propertyDefinitions)
          .where(inArray(propertyDefinitions.key, requiredFields));

        const propDefIds = propDefs.map((pd) => pd.id);
        const filledValues = propDefIds.length > 0
          ? await app.db
              .select({ propertyDefinitionId: dealPropertyValues.propertyDefinitionId })
              .from(dealPropertyValues)
              .where(
                and(
                  eq(dealPropertyValues.dealId, id),
                  inArray(dealPropertyValues.propertyDefinitionId, propDefIds),
                  sql`${dealPropertyValues.value} IS NOT NULL AND ${dealPropertyValues.value} != ''`,
                ),
              )
          : [];

        const filledIds = new Set(filledValues.map((v) => v.propertyDefinitionId));
        const missingDefs = propDefs.filter((pd) => !filledIds.has(pd.id));

        // Also check ownerUserId if required
        const missingFields: string[] = missingDefs.map((pd) => pd.key);
        if (requiredFields.includes('owner_user_id') && !deal.ownerUserId) {
          missingFields.push('owner_user_id');
        }

        if (missingFields.length > 0) {
          return reply.code(400).send({
            error: 'validation_failed',
            missingFields,
          });
        }
      }

      const now = new Date();
      const fromStageId = deal.stageId;

      const [updated] = await app.db
        .update(deals)
        .set({
          stageId: body.stageId,
          isClosedWon: targetStage.isClosedWon,
          isClosedLost: targetStage.isClosedLost,
          currentStageEnteredAt: now,
        })
        .where(eq(deals.id, id))
        .returning();

      await app.db.insert(dealStageEvents).values({
        dealId: id,
        pipelineId: deal.pipelineId,
        fromStageId,
        toStageId: body.stageId,
        changedAt: now,
        changedByUserId: req.user!.id,
        source: 'ui',
      });

      await app.audit({
        userId: req.user!.id,
        action: 'update',
        objectType: 'deal',
        objectId: id,
        diff: { before: { stageId: fromStageId }, after: { stageId: body.stageId } },
      });

      return updated;
    },
  );

  // --------------------------------------------------- add contact
  app.post(
    '/api/deals/:id/contacts',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { contactId: string; role?: string; isPrimary?: boolean };

      if (!body.contactId) return reply.code(400).send({ error: 'contactId_required' });

      const [deal] = await app.db.select({ id: deals.id }).from(deals).where(eq(deals.id, id)).limit(1);
      if (!deal) return reply.code(404).send({ error: 'not_found' });

      const [contact] = await app.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, body.contactId)).limit(1);
      if (!contact) return reply.code(400).send({ error: 'contact_not_found' });

      // If making primary, demote existing primary
      if (body.isPrimary) {
        await app.db
          .update(dealContacts)
          .set({ isPrimary: false })
          .where(and(eq(dealContacts.dealId, id), eq(dealContacts.isPrimary, true)));
      }

      await app.db
        .insert(dealContacts)
        .values({
          dealId: id,
          contactId: body.contactId,
          isPrimary: body.isPrimary ?? false,
          role: body.role ?? null,
        })
        .onConflictDoUpdate({
          target: [dealContacts.dealId, dealContacts.contactId],
          set: { isPrimary: body.isPrimary ?? false, role: body.role ?? null },
        });

      return reply.code(201).send({ ok: true });
    },
  );

  // ------------------------------------------------------- remove contact
  app.delete(
    '/api/deals/:id/contacts/:contactId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id, contactId } = req.params as { id: string; contactId: string };

      const [link] = await app.db
        .select()
        .from(dealContacts)
        .where(and(eq(dealContacts.dealId, id), eq(dealContacts.contactId, contactId)))
        .limit(1);
      if (!link) return reply.code(404).send({ error: 'not_found' });
      if (link.isPrimary) return reply.code(400).send({ error: 'cannot_remove_primary_contact' });

      await app.db
        .delete(dealContacts)
        .where(and(eq(dealContacts.dealId, id), eq(dealContacts.contactId, contactId)));

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------- archive
  app.post(
    '/api/deals/:id/archive',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [deal] = await app.db
        .update(deals)
        .set({ archivedAt: new Date(), archivedByUserId: req.user!.id })
        .where(and(eq(deals.id, id), isNull(deals.archivedAt)))
        .returning();
      if (!deal) return reply.code(404).send({ error: 'not_found_or_already_archived' });
      await app.audit({ userId: req.user!.id, action: 'archive', objectType: 'deal', objectId: id });
      return deal;
    },
  );

  // --------------------------------------------------------------- restore
  app.post(
    '/api/deals/:id/restore',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [deal] = await app.db
        .update(deals)
        .set({ archivedAt: null, archivedByUserId: null })
        .where(and(eq(deals.id, id), isNotNull(deals.archivedAt)))
        .returning();
      if (!deal) return reply.code(404).send({ error: 'not_found_or_not_archived' });
      await app.audit({ userId: req.user!.id, action: 'restore', objectType: 'deal', objectId: id });
      return deal;
    },
  );

  // ----------------------------------------------------------------- users
  app.get(
    '/api/users',
    { preHandler: app.requireAuth },
    async () => {
      return app.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .orderBy(asc(users.name));
    },
  );
}
