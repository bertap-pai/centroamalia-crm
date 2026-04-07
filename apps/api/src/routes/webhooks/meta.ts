import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, or } from 'drizzle-orm';
import {
  contacts,
  deals,
  dealContacts,
  dealStageEvents,
  leadSubmissions,
  stages,
} from '@crm/db';
import { env } from '../../env.js';
import { normalizePhone } from '../../lib/phone.js';
import { fetchLeadData, mapLeadFields } from '../../lib/meta-lead.js';

interface MetaWebhookBody {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        leadgen_id: string;
        page_id: string;
        form_id: string;
        created_time: number;
      };
      field: string;
    }>;
  }>;
}

// Augment FastifyRequest to carry rawBody within this plugin scope
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export default async function metaWebhookRoutes(app: FastifyInstance) {
  // Capture raw body for HMAC verification (scoped to this plugin only)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error);
    }
  });

  // ----------------------------------------- GET verification challenge
  app.get('/api/webhooks/meta', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];

    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: 'forbidden' });
  });

  // ----------------------------------------- POST receive lead notifications
  app.post('/api/webhooks/meta', async (req, reply) => {
      // Always return 200 to Meta — never let errors propagate back
      reply.code(200).send({ ok: true });

      const signature = (req.headers['x-hub-signature-256'] as string) ?? '';
      const rawBody = req.rawBody;

      if (!rawBody) {
        app.log.error('[meta-webhook] Missing raw body for HMAC verification');
        return;
      }

      // Verify HMAC
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');

      let sigBuf: Buffer;
      let expBuf: Buffer;
      try {
        sigBuf = Buffer.from(signature);
        expBuf = Buffer.from(expected);
      } catch {
        app.log.warn('[meta-webhook] Invalid signature header');
        return;
      }
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        app.log.warn('[meta-webhook] HMAC mismatch — discarding request');
        return;
      }

      const body = req.body as MetaWebhookBody;
      if (body.object !== 'page') return;

      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'leadgen') continue;
          const leadgenId = change.value.leadgen_id;
          await processLead(app, leadgenId, change.value);
        }
      }
  });
}

async function processLead(
  app: FastifyInstance,
  leadgenId: string,
  rawValue: unknown,
): Promise<void> {
  let submissionId: string | undefined;

  try {
    // Insert raw submission record immediately
    const [submission] = await app.db
      .insert(leadSubmissions)
      .values({
        source: 'meta',
        payloadRaw: rawValue as any,
        status: 'processed',
      })
      .returning({ id: leadSubmissions.id });

    submissionId = submission?.id;
    if (!submissionId) throw new Error('Failed to insert lead submission');

    // Fetch lead data from Meta Graph API
    const leadData = await fetchLeadData(leadgenId, env.META_PAGE_ACCESS_TOKEN);
    const mapped = mapLeadFields(leadData.field_data);

    const phoneE164 = mapped.phoneE164 ? normalizePhone(mapped.phoneE164) : null;
    const mappedFields: Record<string, unknown> = {
      email: mapped.email,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      ...mapped.extraFields,
    };

    // Update submission with mapped data
    await app.db
      .update(leadSubmissions)
      .set({ mappedPhoneE164: phoneE164, mappedFields })
      .where(eq(leadSubmissions.id, submissionId));

    // Determine status if we can't identify contact
    if (!phoneE164 && !mapped.email) {
      await app.db
        .update(leadSubmissions)
        .set({ status: 'needs_review', errorMessage: 'No phone or email extracted' })
        .where(eq(leadSubmissions.id, submissionId));
      app.log.warn(`[meta-webhook] Lead ${leadgenId} has no phone or email`);
      return;
    }

    // Upsert contact
    let contactId: string;
    const conditions = [];
    if (phoneE164) conditions.push(eq(contacts.phoneE164, phoneE164));
    if (mapped.email) conditions.push(eq(contacts.email, mapped.email));

    const [existing] = await app.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(or(...conditions))
      .limit(1);

    if (existing) {
      contactId = existing.id;
    } else {
      const [newContact] = await app.db
        .insert(contacts)
        .values({
          phoneE164: phoneE164 ?? '',
          firstName: mapped.firstName ?? null,
          lastName: mapped.lastName ?? null,
          email: mapped.email ?? null,
          createdByUserId: null,
        })
        .returning({ id: contacts.id });
      if (!newContact) throw new Error('Failed to insert contact');
      contactId = newContact.id;
    }

    // Verify stage exists
    const [stage] = await app.db
      .select({ id: stages.id, isClosedWon: stages.isClosedWon, isClosedLost: stages.isClosedLost })
      .from(stages)
      .where(eq(stages.id, env.META_DEFAULT_STAGE_ID))
      .limit(1);
    if (!stage) throw new Error(`Stage ${env.META_DEFAULT_STAGE_ID} not found`);

    // Create deal
    const now = new Date();
    const [deal] = await app.db
      .insert(deals)
      .values({
        pipelineId: env.META_DEFAULT_PIPELINE_ID,
        stageId: env.META_DEFAULT_STAGE_ID,
        ownerUserId: null,
        isClosedWon: stage.isClosedWon,
        isClosedLost: stage.isClosedLost,
        currentStageEnteredAt: now,
        createdByUserId: null,
      })
      .returning({ id: deals.id });
    if (!deal) throw new Error('Failed to insert deal');

    await app.db.insert(dealContacts).values({
      dealId: deal.id,
      contactId,
      isPrimary: true,
      role: null,
    });

    await app.db.insert(dealStageEvents).values({
      dealId: deal.id,
      pipelineId: env.META_DEFAULT_PIPELINE_ID,
      fromStageId: null,
      toStageId: env.META_DEFAULT_STAGE_ID,
      changedAt: now,
      changedByUserId: null,
      source: 'api',
    });

    // Update submission with created IDs
    await app.db
      .update(leadSubmissions)
      .set({ createdContactId: contactId, createdDealId: deal.id, status: 'processed' })
      .where(eq(leadSubmissions.id, submissionId));

    app.log.info(`[meta-webhook] Lead ${leadgenId} processed: contact=${contactId} deal=${deal.id}`);
  } catch (err) {
    app.log.error({ err }, `[meta-webhook] Failed to process lead ${leadgenId}`);
    if (submissionId) {
      await app.db
        .update(leadSubmissions)
        .set({
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .where(eq(leadSubmissions.id, submissionId))
        .catch(() => {});
    }
  }
}
