import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../env.js';
import { processLeadFromWebhook } from '../../lib/meta-lead-processor.js';

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
  // Warn at startup when required Meta env vars are missing
  const missingVars = (
    ['META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN', 'META_DEFAULT_PIPELINE_ID', 'META_DEFAULT_STAGE_ID'] as const
  ).filter((k) => !env[k]);
  if (missingVars.length > 0) {
    app.log.warn(
      `[meta-webhook] Meta Lead Ads integration is DISABLED — missing env vars: ${missingVars.join(', ')}`,
    );
  }

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

      if (!env.META_APP_SECRET) {
        app.log.error('[meta-webhook] META_APP_SECRET is not configured — cannot verify webhook signature. Discarding.');
        return;
      }

      if (!env.META_PAGE_ACCESS_TOKEN) {
        app.log.error('[meta-webhook] META_PAGE_ACCESS_TOKEN is not configured — cannot fetch lead data. Discarding.');
        return;
      }

      if (!env.META_DEFAULT_PIPELINE_ID || !env.META_DEFAULT_STAGE_ID) {
        app.log.error('[meta-webhook] META_DEFAULT_PIPELINE_ID or META_DEFAULT_STAGE_ID is not configured. Discarding.');
        return;
      }

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
          await processLeadFromWebhook(app, leadgenId, change.value);
        }
      }
  });
}
