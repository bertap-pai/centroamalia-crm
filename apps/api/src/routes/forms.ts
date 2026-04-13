import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, desc, count, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import {
  forms,
  formFields,
  formSubmissions,
  contacts,
  contactPropertyValues,
  propertyDefinitions,
} from '@crm/db';
import { normalizePhone } from '../lib/phone.js';

// Simple in-memory rate limiter: ip_hash → [timestamps]
const submitRateMap = new Map<string, number[]>();

function isRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxReqs = 5;
  const times = (submitRateMap.get(ipHash) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= maxReqs) return true;
  times.push(now);
  submitRateMap.set(ipHash, times);
  return false;
}

function hashIp(ip: string | undefined): string {
  return createHash('sha256').update(ip ?? 'unknown').digest('hex').slice(0, 16);
}

export default async function formsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get('/api/forms', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const includeArchived = q['includeArchived'] === 'true';

    const conditions = includeArchived ? [] : [isNull(forms.archivedAt)];
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await app.db
      .select()
      .from(forms)
      .where(where)
      .orderBy(desc(forms.createdAt));

    // Attach submission counts
    const ids = rows.map((r) => r.id);
    const subCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const counts = await app.db
        .select({ formId: formSubmissions.formId, total: count() })
        .from(formSubmissions)
        .where(inArray(formSubmissions.formId, ids))
        .groupBy(formSubmissions.formId);
      for (const c of counts) subCounts[c.formId] = Number(c.total);
    }

    return rows.map((f) => ({ ...f, submissionCount: subCounts[f.id] ?? 0 }));
  });

  // ------------------------------------------------------------------ get one
  app.get('/api/forms/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [form] = await app.db.select().from(forms).where(eq(forms.id, id)).limit(1);
    if (!form) return reply.code(404).send({ error: 'not_found' });

    const fields = await app.db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.position);

    return { ...form, fields };
  });

  // ------------------------------------------------------------------ embed (public, no auth)
  app.get('/api/forms/:id/embed', async (req, reply) => {
    const { id } = req.params as { id: string };

    const [form] = await app.db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.status, 'active')))
      .limit(1);
    if (!form) return reply.code(404).send({ error: 'not_found' });

    const fields = await app.db
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, id), eq(formFields.isVisible, true)))
      .orderBy(formFields.position);

    return { ...form, fields };
  });

  // ------------------------------------------------------------------ create
  app.post('/api/forms', { preHandler: app.requireAdmin }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description?: string;
      submitLabel?: string;
      successMessage?: string;
    };

    if (!body.name?.trim()) return reply.code(400).send({ error: 'name_required' });

    const [form] = await app.db
      .insert(forms)
      .values({
        name: body.name.trim(),
        description: body.description ?? null,
        submitLabel: body.submitLabel ?? 'Enviar',
        successMessage: body.successMessage ?? 'Gràcies! Hem rebut el teu missatge.',
        createdByUserId: req.user!.id,
      })
      .returning();

    return reply.code(201).send(form);
  });

  // ------------------------------------------------------------------ update (fields + metadata)
  app.put('/api/forms/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      status?: 'draft' | 'active' | 'paused' | 'archived';
      submitLabel?: string;
      successMessage?: string;
      buttonStyle?: {
        background?: string;
        color?: string;
        borderRadius?: number;
        fontSize?: number;
      };
      fields?: Array<{
        key: string;
        label: string;
        type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';
        placeholder?: string;
        isRequired?: boolean;
        position?: number;
        options?: Array<{ key: string; label: string }>;
        crmPropertyKey?: string;
        isVisible?: boolean;
      }>;
    };

    const [existing] = await app.db.select().from(forms).where(eq(forms.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates['name'] = body.name.trim();
    if (body.description !== undefined) updates['description'] = body.description || null;
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.submitLabel !== undefined) updates['submitLabel'] = body.submitLabel;
    if (body.successMessage !== undefined) updates['successMessage'] = body.successMessage;
    if (body.buttonStyle !== undefined) {
      const existing_bs = existing.buttonStyle as { background: string; color: string; borderRadius: number; fontSize: number };
      updates['buttonStyle'] = { ...existing_bs, ...body.buttonStyle };
    }

    const [updated] = await app.db
      .update(forms)
      .set(updates)
      .where(eq(forms.id, id))
      .returning();

    // Replace fields if provided
    if (body.fields !== undefined) {
      await app.db.delete(formFields).where(eq(formFields.formId, id));
      if (body.fields.length > 0) {
        await app.db.insert(formFields).values(
          body.fields.map((f, idx) => ({
            formId: id,
            key: f.key,
            label: f.label,
            type: f.type,
            placeholder: f.placeholder ?? null,
            isRequired: f.isRequired ?? false,
            position: f.position ?? idx,
            options: f.options ?? [],
            crmPropertyKey: f.crmPropertyKey ?? null,
            isVisible: f.isVisible ?? true,
          })),
        );
      }
    }

    const fields = await app.db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.position);

    return { ...updated, fields };
  });

  // ------------------------------------------------------------------ clone
  app.post('/api/forms/:id/clone', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [original] = await app.db.select().from(forms).where(eq(forms.id, id)).limit(1);
    if (!original) return reply.code(404).send({ error: 'not_found' });

    // Clone the form row
    const [cloned] = await app.db
      .insert(forms)
      .values({
        name: `Còpia de ${original.name}`,
        description: original.description,
        status: 'draft',
        submitLabel: original.submitLabel,
        successMessage: original.successMessage,
        buttonStyle: original.buttonStyle,
        createdByUserId: req.user!.id,
      })
      .returning();

    // Clone all fields
    const originalFields = await app.db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.position);

    if (originalFields.length > 0) {
      await app.db.insert(formFields).values(
        originalFields.map((f) => ({
          formId: cloned!.id,
          key: f.key,
          label: f.label,
          type: f.type,
          placeholder: f.placeholder,
          isRequired: f.isRequired,
          isVisible: f.isVisible,
          position: f.position,
          options: f.options,
          crmPropertyKey: f.crmPropertyKey,
        })),
      );
    }

    const clonedFields = await app.db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, cloned!.id))
      .orderBy(formFields.position);

    return reply.code(201).send({ ...cloned, fields: clonedFields });
  });

  // ------------------------------------------------------------------ delete (soft)
  app.delete('/api/forms/:id', { preHandler: app.requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [existing] = await app.db.select().from(forms).where(eq(forms.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    await app.db
      .update(forms)
      .set({ archivedAt: new Date(), status: 'archived', updatedAt: new Date() })
      .where(eq(forms.id, id));

    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ submit (public)
  app.post('/api/forms/:id/submit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    // Honeypot: if _hp field is filled, silently succeed
    if (body['_hp']) return reply.code(200).send({ ok: true });

    // Extract tracking params before processing form fields
    const trackingParams = typeof body['_tracking'] === 'object' && body['_tracking'] !== null
      ? body['_tracking'] as Record<string, string>
      : {};
    delete body['_tracking'];
    delete body['_hp'];

    // From here on, body contains only form field values
    const formData = body as Record<string, string>;

    // Rate limiting by IP
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.socket.remoteAddress;
    const ipHash = hashIp(ip);
    if (isRateLimited(ipHash)) return reply.code(429).send({ error: 'too_many_requests' });

    // Load form + fields
    const [form] = await app.db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.status, 'active')))
      .limit(1);
    if (!form) return reply.code(404).send({ error: 'not_found' });

    const fields = await app.db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.position);

    // Validate required fields (skip hidden fields — user cannot fill them)
    for (const field of fields) {
      if (field.isRequired && field.isVisible && !formData[field.key]?.trim()) {
        return reply.code(400).send({ error: 'required_field_missing', field: field.key });
      }
    }

    // CRM integration: find or create contact
    let createdContactId: string | null = null;
    const emailField = fields.find((f) => f.type === 'email' || f.crmPropertyKey === 'email');
    const phoneField = fields.find((f) => f.type === 'phone' || f.crmPropertyKey === 'phone');
    const emailValue = emailField ? formData[emailField.key]?.trim() : undefined;
    const phoneValue = phoneField ? formData[phoneField.key]?.trim() : undefined;

    // Reserved crmPropertyKey sentinels that write to core contact columns (not propertyDefinitions)
    const coreFieldMap: Record<string, string | undefined> = {};
    for (const coreKey of ['firstName', 'lastName'] as const) {
      const field = fields.find((f) => f.crmPropertyKey === coreKey);
      const val = field ? formData[field.key]?.trim() : undefined;
      if (val) coreFieldMap[coreKey] = val;
    }

    if (emailValue || phoneValue) {
      // Try to find existing contact
      let existingContact = null;

      if (emailValue) {
        const [found] = await app.db
          .select()
          .from(contacts)
          .where(eq(contacts.email, emailValue))
          .limit(1);
        existingContact = found ?? null;
      }

      if (!existingContact && phoneValue) {
        const phoneE164 = normalizePhone(phoneValue);
        if (phoneE164) {
          const [found] = await app.db
            .select()
            .from(contacts)
            .where(eq(contacts.phoneE164, phoneE164))
            .limit(1);
          existingContact = found ?? null;
        }
      }

      if (existingContact) {
        createdContactId = existingContact.id;
        // Update core fields on existing contact if provided
        if (Object.keys(coreFieldMap).length > 0) {
          await app.db
            .update(contacts)
            .set({ ...coreFieldMap, updatedAt: new Date() })
            .where(eq(contacts.id, createdContactId!));
        }
      } else {
        // Create new contact with core fields
        const phoneE164 = phoneValue ? normalizePhone(phoneValue) : null;
        const [newContact] = await app.db
          .insert(contacts)
          .values({
            email: emailValue ?? null,
            phoneE164: phoneE164 ?? null,
            firstName: coreFieldMap['firstName'] ?? null,
            lastName: coreFieldMap['lastName'] ?? null,
          })
          .returning();
        createdContactId = newContact!.id;
      }

      // Write CRM-mapped properties (skip core contact fields handled above)
      const CORE_CONTACT_KEYS = new Set(['firstName', 'lastName', 'email', 'phone']);
      if (createdContactId) {
        const mappedKeys = fields
          .filter((f) => f.crmPropertyKey && formData[f.key] && !CORE_CONTACT_KEYS.has(f.crmPropertyKey))
          .map((f) => f.crmPropertyKey!);

        if (mappedKeys.length > 0) {
          const propDefs = await app.db
            .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
            .from(propertyDefinitions)
            .where(inArray(propertyDefinitions.key, mappedKeys));

          for (const pd of propDefs) {
            const field = fields.find((f) => f.crmPropertyKey === pd.key);
            if (!field) continue;
            const val = formData[field.key];
            if (!val) continue;
            await app.db
              .insert(contactPropertyValues)
              .values({ contactId: createdContactId, propertyDefinitionId: pd.id, value: val })
              .onConflictDoUpdate({
                target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
                set: { value: val, updatedAt: new Date() },
              });
          }
        }
      }

      // Sync UTM tracking params and attribution to contact properties
      if (createdContactId && Object.keys(trackingParams).length > 0) {
        const UTM_TO_PROPS: Record<string, { first: string; last: string }> = {
          utm_source: { first: 'first_utm_source', last: 'last_utm_source' },
          utm_campaign: { first: 'first_utm_campaign', last: 'last_utm_campaign' },
          utm_medium: { first: 'first_utm_medium', last: 'last_utm_medium' },
        };

        const allAttrKeys: string[] = [];
        for (const mapping of Object.values(UTM_TO_PROPS)) {
          allAttrKeys.push(mapping.first, mapping.last);
        }

        if (allAttrKeys.length > 0) {
          const attrPropDefs = await app.db
            .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
            .from(propertyDefinitions)
            .where(inArray(propertyDefinitions.key, allAttrKeys));

          const propDefByKey = new Map(attrPropDefs.map((p) => [p.key, p.id]));

          // Check which first_* properties already have values
          const firstPropDefIds = attrPropDefs
            .filter((p) => p.key.startsWith('first_'))
            .map((p) => p.id);

          const existingFirstValues = firstPropDefIds.length > 0
            ? await app.db
                .select({ propertyDefinitionId: contactPropertyValues.propertyDefinitionId })
                .from(contactPropertyValues)
                .where(
                  and(
                    eq(contactPropertyValues.contactId, createdContactId!),
                    inArray(contactPropertyValues.propertyDefinitionId, firstPropDefIds),
                  ),
                )
            : [];

          const existingFirstPropIds = new Set(existingFirstValues.map((v) => v.propertyDefinitionId));

          for (const [paramKey, mapping] of Object.entries(UTM_TO_PROPS)) {
            const val = trackingParams[paramKey];
            if (!val) continue;

            // Always update last_* property
            const lastPropId = propDefByKey.get(mapping.last);
            if (lastPropId) {
              await app.db
                .insert(contactPropertyValues)
                .values({ contactId: createdContactId!, propertyDefinitionId: lastPropId, value: val })
                .onConflictDoUpdate({
                  target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
                  set: { value: val, updatedAt: new Date() },
                });
            }

            // Only set first_* if not already set
            const firstPropId = propDefByKey.get(mapping.first);
            if (firstPropId && !existingFirstPropIds.has(firstPropId)) {
              await app.db
                .insert(contactPropertyValues)
                .values({ contactId: createdContactId!, propertyDefinitionId: firstPropId, value: val })
                .onConflictDoNothing();
            }
          }
        }
      }
    }

    // Save submission
    const [submission] = await app.db
      .insert(formSubmissions)
      .values({
        formId: id,
        data: formData,
        createdContactId,
        trackingParams: Object.keys(trackingParams).length > 0 ? trackingParams : null,
        sourceUrl: req.headers['referer']?.toString() ?? null,
        ipHash,
      })
      .returning();

    return { ok: true, submissionId: submission!.id };
  });

  // ------------------------------------------------------------------ submissions list
  app.get('/api/forms/:id/submissions', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q['pageSize'] ?? '50', 10)));
    const offset = (page - 1) * pageSize;

    const [form] = await app.db.select().from(forms).where(eq(forms.id, id)).limit(1);
    if (!form) return reply.code(404).send({ error: 'not_found' });

    const [countRow] = await app.db
      .select({ total: count() })
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, id));

    const rows = await app.db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, id))
      .orderBy(desc(formSubmissions.submittedAt))
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows,
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  });
}
