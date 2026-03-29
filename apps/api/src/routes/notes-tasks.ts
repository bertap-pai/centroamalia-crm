import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { notes, tasks, users } from '@crm/db';

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

    const rows = await app.db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.objectType, objectType),
          eq(notes.objectId, objectId),
          isNull(notes.archivedAt),
        ),
      )
      .orderBy(desc(notes.createdAt));

    // Attach author names
    const authorIds = [...new Set(rows.flatMap((r) => r.createdByUserId ? [r.createdByUserId] : []))];
    const authorMap: Record<string, string> = {};
    if (authorIds.length > 0) {
      const authorRows = await app.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, authorIds));
      for (const a of authorRows) authorMap[a.id] = a.name ?? a.id;
    }

    return rows.map((n) => ({
      ...n,
      authorName: n.createdByUserId ? (authorMap[n.createdByUserId] ?? null) : null,
    }));
  });

  // Create note
  app.post('/api/notes', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = req.body as { objectType: string; objectId: string; body: string };
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
      })
      .returning();

    await app.audit({
      userId: req.user!.id,
      action: 'create',
      objectType: 'note',
      objectId: note!.id,
      diff: { after: { objectType: body.objectType, objectId: body.objectId } },
    });

    return reply.code(201).send({
      ...note,
      authorName: req.user!.name ?? null,
    });
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

  // List tasks for an object
  app.get('/api/tasks', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { objectType, objectId } = q;
    if (!objectType || !objectId) {
      return reply.code(400).send({ error: 'objectType_and_objectId_required' });
    }
    if (objectType !== 'contact' && objectType !== 'deal') {
      return reply.code(400).send({ error: 'invalid_object_type' });
    }

    const rows = await app.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.objectType, objectType),
          eq(tasks.objectId, objectId),
          isNull(tasks.archivedAt),
        ),
      )
      .orderBy(desc(tasks.createdAt));

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

    return rows.map((t) => ({
      ...t,
      assigneeName: t.assignedToUserId ? (assigneeMap[t.assignedToUserId] ?? null) : null,
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
