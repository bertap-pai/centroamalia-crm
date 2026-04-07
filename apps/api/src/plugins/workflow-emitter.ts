import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eventBus } from '../lib/event-bus.js';

/**
 * Fastify plugin that hooks into CRM route responses to emit events.
 *
 * Strategy: uses onResponse hooks to emit events AFTER successful mutations.
 * For contact updates, old values are captured via a preHandler that pre-fetches
 * the contact before the route handler runs.
 */
async function workflowEmitterPlugin(app: FastifyInstance): Promise<void> {
  // Hook into all routes — we filter by URL pattern in the hook
  app.addHook('onResponse', async (req, reply) => {
    // Only process successful mutations
    if (reply.statusCode >= 400) return;

    const method = req.method;
    const url = req.url;
    const userId = req.user?.id;

    try {
      // Contact created
      if (method === 'POST' && url === '/api/contacts' && reply.statusCode === 201) {
        const body = (req as any).__responseBody;
        if (body?.id) {
          eventBus.emit('contact.created', {
            contactId: body.id,
            ...(userId ? { userId } : {}),
          });
        }
      }

      // Contact updated
      if (method === 'PATCH' && /^\/api\/contacts\/[^/]+$/.test(url)) {
        const contactId = url.split('/')[3]!;
        const oldContact = (req as any).__oldContact;
        const body = req.body as Record<string, unknown> | undefined;

        if (contactId) {
          eventBus.emit('contact.updated', {
            contactId,
            changes: {},
            ...(userId ? { userId } : {}),
          });

          // Emit property.changed events for individual changes
          if (oldContact && body) {
            const fieldMap: Record<string, string> = {
              firstName: 'first_name',
              lastName: 'last_name',
              email: 'email',
              phone: 'phone_e164',
            };

            for (const [bodyKey, propName] of Object.entries(fieldMap)) {
              if (body[bodyKey] !== undefined) {
                const oldVal = oldContact[bodyKey === 'phone' ? 'phoneE164' : bodyKey];
                const newVal = body[bodyKey];
                if (oldVal !== newVal) {
                  eventBus.emit('property.changed', {
                    contactId,
                    property: propName,
                    oldValue: oldVal,
                    newValue: newVal,
                    ...(userId ? { userId } : {}),
                  });
                }
              }
            }

            // Dynamic property changes
            if (body.properties && typeof body.properties === 'object') {
              for (const [key, value] of Object.entries(body.properties as Record<string, string>)) {
                eventBus.emit('property.changed', {
                  contactId,
                  property: key,
                  oldValue: undefined,
                  newValue: value,
                  ...(userId ? { userId } : {}),
                });
              }
            }
          }
        }
      }

      // Contact archived (soft delete)
      if (method === 'POST' && /^\/api\/contacts\/[^/]+\/archive$/.test(url)) {
        const contactId = url.split('/')[3]!;
        if (contactId) {
          eventBus.emit('contact.deleted', {
            contactId,
            ...(userId ? { userId } : {}),
          });
        }
      }

      // Deal created
      if (method === 'POST' && url === '/api/deals' && reply.statusCode === 201) {
        const body = (req as any).__responseBody;
        if (body?.id) {
          eventBus.emit('deal.created', {
            dealId: body.id,
            ...(body.contactId ? { contactId: body.contactId } : {}),
            ...(userId ? { userId } : {}),
          });
        }
      }

      // Task completed
      if (method === 'PATCH' && /^\/api\/tasks\/[^/]+$/.test(url)) {
        const body = req.body as Record<string, unknown> | undefined;
        if (body?.status === 'done') {
          const taskId = url.split('/')[3]!;
          eventBus.emit('task.completed', {
            taskId,
            ...(userId ? { userId } : {}),
          });
        }
      }

      // Form submission
      if (method === 'POST' && /^\/api\/forms\/[^/]+\/submit$/.test(url)) {
        const body = (req as any).__responseBody;
        if (body?.id) {
          const formId = url.split('/')[3]!;
          eventBus.emit('form.submitted', {
            formId,
            formName: body.formName ?? '',
            submissionId: body.id,
            contactId: body.createdContactId ?? '',
            data: body.data ?? {},
          });
        }
      }
    } catch (err) {
      // Never let event emission break the response
      app.log.error({ err }, '[workflow-emitter] Failed to emit event');
    }
  });

  // Pre-handler to capture old contact values before update
  app.addHook('preHandler', async (req) => {
    if (req.method === 'PATCH' && /^\/api\/contacts\/[^/]+$/.test(req.url)) {
      const contactId = req.url.split('/')[3];
      if (contactId) {
        try {
          const { contacts } = await import('@crm/db');
          const { eq } = await import('drizzle-orm');
          const [old] = await app.db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId))
            .limit(1);
          (req as any).__oldContact = old ?? null;
        } catch {
          // Non-fatal
        }
      }
    }
  });
}

export default fp(workflowEmitterPlugin, {
  name: 'workflow-emitter',
});
