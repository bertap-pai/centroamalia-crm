import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  eq,
  and,
  or,
  ilike,
  isNull,
  gte,
  lte,
  desc,
  asc,
  count,
  inArray,
  sql,
} from 'drizzle-orm';
import {
  lists,
  listMemberships,
  contacts,
  contactPropertyValues,
  propertyDefinitions,
  deals,
  dealContacts,
  dealPropertyValues,
  pipelines,
  stages,
  users,
} from '@crm/db';

export default async function listsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get('/api/lists', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const objectType = q['objectType'];
    const includeArchived = q['includeArchived'] === 'true';

    const conditions: any[] = [];
    if (objectType) conditions.push(eq(lists.objectType, objectType));
    if (!includeArchived) conditions.push(isNull(lists.archivedAt));

    const rows = await app.db
      .select()
      .from(lists)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(lists.name));

    // Member counts for static lists
    const staticIds = rows.filter((r) => r.kind === 'static').map((r) => r.id);
    const memberCounts: Record<string, number> = {};
    if (staticIds.length > 0) {
      const countRows = await app.db
        .select({ listId: listMemberships.listId, cnt: count() })
        .from(listMemberships)
        .where(inArray(listMemberships.listId, staticIds))
        .groupBy(listMemberships.listId);
      for (const r of countRows) memberCounts[r.listId] = Number(r.cnt);
    }

    return rows.map((r) => ({
      ...r,
      memberCount: r.kind === 'static' ? (memberCounts[r.id] ?? 0) : null,
    }));
  });

  // ---------------------------------------------------------------- create
  app.post('/api/lists', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      objectType: 'contact' | 'deal';
      kind?: 'static' | 'dynamic';
      criteria?: Record<string, any> | null;
      isTeam?: boolean;
    };

    if (!body.name || !body.objectType) {
      return reply.code(400).send({ error: 'name_and_object_type_required' });
    }

    const [row] = await app.db
      .insert(lists)
      .values({
        name: body.name,
        description: body.description ?? null,
        objectType: body.objectType,
        kind: body.kind ?? 'static',
        criteria: body.criteria ?? null,
        isTeam: body.isTeam ?? false,
        createdByUserId: req.user!.id,
      })
      .returning();

    await app.audit({ userId: req.user!.id, action: 'create', objectType: 'list', objectId: row!.id });
    return reply.code(201).send(row);
  });

  // ----------------------------------------------------------------- get
  app.get('/api/lists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [row] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'list_not_found' });

    let memberCount: number | null = null;
    if (row.kind === 'static') {
      const [cr] = await app.db
        .select({ cnt: count() })
        .from(listMemberships)
        .where(eq(listMemberships.listId, id));
      memberCount = Number(cr?.cnt ?? 0);
    }

    return { ...row, memberCount };
  });

  // --------------------------------------------------------------- update
  app.patch('/api/lists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      criteria?: Record<string, any> | null;
      isTeam?: boolean;
      archived?: boolean;
    };

    const [existing] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'list_not_found' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.criteria !== undefined) updates.criteria = body.criteria;
    if (body.isTeam !== undefined) updates.isTeam = body.isTeam;
    if (body.archived === false) {
      updates.archivedAt = null;
      updates.archivedByUserId = null;
    } else if (body.archived === true) {
      updates.archivedAt = new Date();
      updates.archivedByUserId = req.user!.id;
    }

    const [updated] = await app.db.update(lists).set(updates).where(eq(lists.id, id)).returning();
    await app.audit({ userId: req.user!.id, action: 'update', objectType: 'list', objectId: id });
    return updated;
  });

  // -------------------------------------------------------------- delete (soft)
  app.delete('/api/lists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [existing] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'list_not_found' });

    await app.db
      .update(lists)
      .set({ archivedAt: new Date(), archivedByUserId: req.user!.id, updatedAt: new Date() })
      .where(eq(lists.id, id));

    await app.audit({ userId: req.user!.id, action: 'archive', objectType: 'list', objectId: id });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------ list members
  app.get('/api/lists/:id/members', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;

    const [list] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
    if (!list) return reply.code(404).send({ error: 'list_not_found' });

    const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
    const offset = (page - 1) * pageSize;

    // For dynamic lists, merge criteria with explicit query params (explicit wins)
    const params: Record<string, string> =
      list.kind === 'dynamic' && list.criteria
        ? { ...(list.criteria as Record<string, string>), ...q }
        : { ...q };

    if (list.objectType === 'contact') {
      return getContactMembers(app, list, params, page, pageSize, offset, reply);
    } else {
      return getDealMembers(app, list, params, page, pageSize, offset, reply);
    }
  });

  // ----------------------------------------------------------- add member
  app.post('/api/lists/:id/members', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { objectId: string };

    const [list] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
    if (!list) return reply.code(404).send({ error: 'list_not_found' });
    if (list.kind === 'dynamic') {
      return reply.code(400).send({ error: 'cannot_add_members_to_dynamic_list' });
    }

    const [existing] = await app.db
      .select()
      .from(listMemberships)
      .where(and(eq(listMemberships.listId, id), eq(listMemberships.objectId, body.objectId)))
      .limit(1);
    if (existing) return reply.code(409).send({ error: 'already_a_member' });

    const [row] = await app.db
      .insert(listMemberships)
      .values({ listId: id, objectId: body.objectId, addedByUserId: req.user!.id })
      .returning();

    return reply.code(201).send(row);
  });

  // --------------------------------------------------------- remove member
  app.delete(
    '/api/lists/:id/members/:objectId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id, objectId } = req.params as { id: string; objectId: string };

      const [list] = await app.db.select().from(lists).where(eq(lists.id, id)).limit(1);
      if (!list) return reply.code(404).send({ error: 'list_not_found' });
      if (list.kind === 'dynamic') {
        return reply.code(400).send({ error: 'cannot_remove_members_from_dynamic_list' });
      }

      await app.db
        .delete(listMemberships)
        .where(and(eq(listMemberships.listId, id), eq(listMemberships.objectId, objectId)));

      return reply.code(204).send();
    },
  );
}

// ─── Members helpers ──────────────────────────────────────────────────────────

async function getContactMembers(
  app: FastifyInstance,
  list: { id: string; kind: string },
  params: Record<string, string>,
  page: number,
  pageSize: number,
  offset: number,
  reply: FastifyReply,
) {
  const search = params['q'] ?? '';
  const includeArchived = params['includeArchived'] === 'true';
  const createdFrom = params['createdFrom'];
  const createdTo = params['createdTo'];
  const sortDir = params['sortDir'] === 'asc' ? 'asc' : 'desc';
  const sortFieldMap: Record<string, any> = {
    created_at: contacts.createdAt,
    first_name: contacts.firstName,
    last_name: contacts.lastName,
    email: contacts.email,
    phone_e164: contacts.phoneE164,
  };
  const sortCol = sortFieldMap[params['sort'] ?? ''] ?? contacts.createdAt;
  const orderBy = sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

  const conditions: any[] = [];
  if (!includeArchived) conditions.push(isNull(contacts.archivedAt));
  if (createdFrom) conditions.push(gte(contacts.createdAt, new Date(createdFrom)));
  if (createdTo) conditions.push(lte(contacts.createdAt, new Date(createdTo)));
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

  if (list.kind === 'static') {
    conditions.push(
      sql`${contacts.id} IN (
        SELECT lm.object_id FROM list_memberships lm WHERE lm.list_id = ${list.id}
      )` as any,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await app.db.select({ total: count() }).from(contacts).where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await app.db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phoneE164: contacts.phoneE164,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset);

  return { data: rows, total, page, pageSize };
}

async function getDealMembers(
  app: FastifyInstance,
  list: { id: string; kind: string },
  params: Record<string, string>,
  page: number,
  pageSize: number,
  offset: number,
  reply: FastifyReply,
) {
  const includeArchived = params['includeArchived'] === 'true';
  const createdFrom = params['createdFrom'];
  const createdTo = params['createdTo'];
  const sortDir = params['sortDir'] === 'asc' ? 'asc' : 'desc';
  const sortFieldMap: Record<string, any> = {
    created_at: deals.createdAt,
    updated_at: deals.updatedAt,
    current_stage_entered_at: deals.currentStageEnteredAt,
  };
  const sortCol = sortFieldMap[params['sort'] ?? ''] ?? deals.createdAt;
  const orderBy = sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

  const conditions: any[] = [];
  if (!includeArchived) conditions.push(isNull(deals.archivedAt));
  if (createdFrom) conditions.push(gte(deals.createdAt, new Date(createdFrom)));
  if (createdTo) conditions.push(lte(deals.createdAt, new Date(createdTo)));
  if (list.kind === 'static') {
    conditions.push(
      sql`${deals.id} IN (
        SELECT lm.object_id FROM list_memberships lm WHERE lm.list_id = ${list.id}
      )` as any,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await app.db.select({ total: count() }).from(deals).where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await app.db
    .select()
    .from(deals)
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset);

  if (rows.length === 0) return { data: [], total, page, pageSize };

  const ids = rows.map((r) => r.id);

  // Primary contacts
  const primaryContacts = await app.db
    .select({
      dealId: dealContacts.dealId,
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
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(inArray(pipelines.id, pipelineIds));
  const pipelineMap: Record<string, string> = {};
  for (const p of pipelineRows) pipelineMap[p.id] = p.name;
  const stageRows = await app.db
    .select({ id: stages.id, name: stages.name })
    .from(stages)
    .where(inArray(stages.id, stageIds));
  const stageMap: Record<string, string> = {};
  for (const s of stageRows) stageMap[s.id] = s.name;

  // Owner names
  const ownerIds = [...new Set(rows.flatMap((r) => (r.ownerUserId ? [r.ownerUserId] : [])))];
  const ownerMap: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const ownerRows = await app.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const o of ownerRows) ownerMap[o.id] = o.name ?? o.id;
  }

  return {
    data: rows.map((d) => ({
      id: d.id,
      primaryContact: primaryContactByDeal[d.id] ?? null,
      pipelineName: pipelineMap[d.pipelineId] ?? null,
      stageName: stageMap[d.stageId] ?? null,
      ownerName: d.ownerUserId ? (ownerMap[d.ownerUserId] ?? null) : null,
      createdAt: d.createdAt,
    })),
    total,
    page,
    pageSize,
  };
}
