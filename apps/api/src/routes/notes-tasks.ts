import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, gte, lte, asc, desc, inArray } from 'drizzle-orm';
import { notes, tasks, users, contacts, deals } from '@crm/db';

export default async function notesTasksRoutes(app: FastifyInstance) {
  // ─── Notes ──────────────────────────────────────────────────────────────────

  // List notes for an object
  app.get('/api/notes', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { objectType, objectId } = q;
    if (!objectType || !objectId) {
      return reply.code(400).send({ error: 'objectType_and_objectId_required' });
    }
    if (objectType !== 'contact' && objectType !== 'deal') {
      return reply.code(400).send({ error: 'invalid_object_type' });
    }

    // Fetch all non-archived notes for this object (top-level and replies)
    const allRows = await app.db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.objectType, objectType),
          eq(notes.objectId, objectId),
          isNull(notes.archivedAt),
        ),
      )
      .orderBy(asc(notes.createdAt));

    // Collect all unique author IDs
    const authorIds = [...new Set(allRows.flatMap((r) => r.createdByUserId ? [r.createdByUserId] : []))];
    const authorMap: Record<string, string> = {};
    if (authorIds.length > 0) {
      const authorRows = await app.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, authorIds));
      for (const a of authorRows) authorMap[a.id] = a.name ?? a.id;
    }

    const toShape = (n: typeof allRows[number]) => ({
      id: n.id,
      body: n.body,
      authorName: n.createdByUserId ? (authorMap[n.createdByUserId] ?? null) : null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt ?? null,
      parentNoteId: n.parentNoteId ?? null,
    });

    const repliesMap: Record<string, ReturnType<typeof toShape>[]> = {};
    for (const r of allRows) {
      if (r.parentNoteId) {
        if (!repliesMap[r.parentNoteId]) repliesMap[r.parentNoteId] = [];
        repliesMap[r.parentNoteId]!.push(toShape(r));
      }
    }

    // Return top-level notes (desc) with nested replies (asc, already ordered)
    const topLevel = allRows.filter((r) => !r.parentNoteId).reverse();
    return topLevel.map((n) => ({
      ...toShape(n),
      replies: repliesMap[n.id] ?? [],
    }));
  });

  // Create note
  app.post('/api/notes', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = req.body as { objectType: string; objectId: string; body: string; parentNoteId?: string };
    if (!body.objectType || !body.objectId || !body.body?.trim()) {
      return reply.code(400).send({ error: 'objectType_objectId_body_required' });
    }
    if (body.objectType !== 'contact' && body.objectType !== 'deal') {
      return reply.code(400).send({ error: 'invalid_object_type' });
    }

    const [note] = await app.db
      .insert(notes)
      .values({
        objectType: body.objectType as 'contact' | 'deal',
        objectId: body.objectId,
        body: body.body.trim(),
        createdByUserId: req.user!.id,
        parentNoteId: body.parentNoteId ?? null,
      })
      .returning();

    await app.audit({
      userId: req.user!.id,
      action: 'create',
      objectType: 'note',
      objectId: note!.id,
      diff: { after: { objectType: body.objectType, objectId: body.objectId, parentNoteId: body.parentNoteId ?? null } },
    });

    return reply.code(201).send({
      id: note!.id,
      body: note!.body,
      authorName: req.user!.name ?? null,
      createdAt: note!.createdAt,
      updatedAt: null,
      parentNoteId: note!.parentNoteId ?? null,
    });
  });

  // Edit note body
  app.patch('/api/notes/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { body: string };
    if (!body.body?.trim()) {
      return reply.code(400).send({ error: 'body_required' });
    }

    const [note] = await app.db
      .update(notes)
      .set({ body: body.body.trim(), updatedAt: new Date(), updatedByUserId: req.user!.id })
      .where(and(eq(notes.id, id), isNull(notes.archivedAt)))
      .returning();
    if (!note) return reply.code(404).send({ error: 'not_found' });

    await app.audit({
      userId: req.user!.id,
      action: 'update',
      objectType: 'note',
      objectId: note.id,
      diff: { after: { body: note.body } },
    });

    return {
      id: note.id,
      body: note.body,
      updatedAt: note.updatedAt,
    };
  });

  // Archive (delete) note
  app.delete('/api/notes/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [note] = await app.db
      .update(notes)
      .set({ archivedAt: new Date(), archivedByUserId: req.user!.id })
      .where(and(eq(notes.id, id), isNull(notes.archivedAt)))
      .returning();
    if (!note) return reply.code(404).send({ error: 'not_found_or_already_deleted' });
    return reply.code(204).send();
  });

  // ─── Tasks ──────────────────────────────────────────────────────────────────

  // List tasks — filtered by object when objectType+objectId provided, or all tasks otherwise
  app.get('/api/tasks', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { objectType, objectId, status, assignedToUserId, dueDateFrom, dueDateTo, sortBy, sortDir } = q;

    // If filtering by object, both params are required (unless standalone objectType filter)
    if (objectId && !objectType) {
      return reply.code(400).send({ error: 'objectType_and_objectId_required' });
    }
    if ((objectType && !['contact', 'deal'].includes(objectType)) || (objectId && objectType && !objectId)) {
      return reply.code(400).send({ error: 'invalid_object_type' });
    }

    const conditions = [isNull(tasks.archivedAt)];
    if (objectType && objectId) {
      conditions.push(eq(tasks.objectType, objectType as 'contact' | 'deal'));
      conditions.push(eq(tasks.objectId, objectId));
    } else if (objectType && !objectId) {
      conditions.push(eq(tasks.objectType, objectType as 'contact' | 'deal'));
    }
    if (status === 'open' || status === 'done') {
      conditions.push(eq(tasks.status, status));
    }
    if (assignedToUserId) {
      conditions.push(eq(tasks.assignedToUserId, assignedToUserId));
    }
    if (dueDateFrom) {
      conditions.push(gte(tasks.dueAt, new Date(dueDateFrom)));
    }
    if (dueDateTo) {
      conditions.push(lte(tasks.dueAt, new Date(dueDateTo)));
    }

    const colMap = { due_at: tasks.dueAt, title: tasks.title, created_at: tasks.createdAt };
    const sortCol = colMap[sortBy as keyof typeof colMap] ?? tasks.createdAt;
    const sortOrder = sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

    const rows = await app.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(sortOrder);

    // Attach assignee names
    const assigneeIds = [...new Set(rows.flatMap((r) => r.assignedToUserId ? [r.assignedToUserId] : []))];
    const assigneeMap: Record<string, string> = {};
    if (assigneeIds.length > 0) {
      const assigneeRows = await app.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, assigneeIds));
      for (const a of assigneeRows) assigneeMap[a.id] = a.name ?? a.id;
    }

    // When returning all tasks, also resolve object display names
    let objectNames: Record<string, string> = {};
    if (!objectType) {
      const contactIds = [...new Set(rows.filter((r) => r.objectType === 'contact').map((r) => r.objectId))];
      const dealIds = [...new Set(rows.filter((r) => r.objectType === 'deal').map((r) => r.objectId))];

      if (contactIds.length > 0) {
        const contactRows = await app.db
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, phoneE164: contacts.phoneE164 })
          .from(contacts)
          .where(inArray(contacts.id, contactIds));
        for (const c of contactRows) {
          objectNames[c.id] = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phoneE164 || c.id;
        }
      }
      if (dealIds.length > 0) {
        const dealRows = await app.db
          .select({ id: deals.id })
          .from(deals)
          .where(inArray(deals.id, dealIds));
        for (const d of dealRows) {
          objectNames[d.id] = objectNames[d.id] ?? d.id;
        }
      }
    }

    return rows.map((t) => ({
      ...t,
      assigneeName: t.assignedToUserId ? (assigneeMap[t.assignedToUserId] ?? null) : null,
      objectName: objectNames[t.objectId] ?? null,
    }));
  });

  // Create task
  app.post('/api/tasks', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = req.body as {
      objectType: string;
      objectId: string;
      title: string;
      dueAt?: string | null;
      assignedToUserId?: string | null;
    };
    if (!body.objectType || !body.objectId || !body.title?.trim()) {
      return reply.code(400).send({ error: 'objectType_objectId_title_required' });
    }
    if (body.objectType !== 'contact' && body.objectType !== 'deal') {
      return reply.code(400).send({ error: 'invalid_object_type' });
    }

    const [task] = await app.db
      .insert(tasks)
      .values({
        objectType: body.objectType as 'contact' | 'deal',
        objectId: body.objectId,
        title: body.title.trim(),
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        assignedToUserId: body.assignedToUserId ?? null,
      })
      .returning();

    await app.audit({
      userId: req.user!.id,
      action: 'create',
      objectType: 'task',
      objectId: task!.id,
      diff: { after: { objectType: body.objectType, objectId: body.objectId, title: body.title } },
    });

    return reply.code(201).send(task);
  });

  // Update task (status, title, dueAt, assignedToUserId)
  app.patch('/api/tasks/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      title?: string;
      dueAt?: string | null;
      status?: 'open' | 'done';
      assignedToUserId?: string | null;
    };

    const updates: Record<string, any> = {};
    if (body.title !== undefined) updates['title'] = body.title.trim();
    if (body.dueAt !== undefined) updates['dueAt'] = body.dueAt ? new Date(body.dueAt) : null;
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.assignedToUserId !== undefined) updates['assignedToUserId'] = body.assignedToUserId;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'no_fields_to_update' });
    }

    const [task] = await app.db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), isNull(tasks.archivedAt)))
      .returning();
    if (!task) return reply.code(404).send({ error: 'not_found' });

    return task;
  });

  // Archive (delete) task
  app.delete('/api/tasks/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [task] = await app.db
      .update(tasks)
      .set({ archivedAt: new Date(), archivedByUserId: req.user!.id })
      .where(and(eq(tasks.id, id), isNull(tasks.archivedAt)))
      .returning();
    if (!task) return reply.code(404).send({ error: 'not_found_or_already_deleted' });
    return reply.code(204).send();
  });
}
