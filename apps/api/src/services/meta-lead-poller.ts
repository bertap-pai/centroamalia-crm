import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { MetaLeadData } from '../lib/meta-lead.js';
import { env } from '../env.js';
import { processLeadFromData } from '../lib/meta-lead-processor.js';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const INITIAL_DELAY_MS = 5_000; // 5 seconds
const LOOKBACK_MS = 70 * 60 * 1000; // 70 minutes (10-min buffer over poll interval)
const LEADS_PER_FORM_LIMIT = 100;

interface MetaFormListResponse {
  data: Array<{ id: string; name?: string }>;
  paging?: { next?: string };
}

interface MetaLeadsResponse {
  data: MetaLeadData[];
  paging?: { next?: string };
}

async function metaLeadPollerPlugin(app: FastifyInstance): Promise<void> {
  const requiredVars = ['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN', 'META_DEFAULT_PIPELINE_ID', 'META_DEFAULT_STAGE_ID'] as const;
  const missing = requiredVars.filter((k) => !env[k]);

  if (missing.length > 0) {
    app.log.warn(
      `[meta-lead-poller] Polling is DISABLED — missing env vars: ${missing.join(', ')}`,
    );
    return;
  }

  async function pollLeads(): Promise<void> {
    try {
      app.log.info('[meta-lead-poller] Starting lead poll cycle');

      // Discover active leadgen forms for the page
      const formsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(env.META_PAGE_ID)}/leadgen_forms?access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN)}`;
      const formsRes = await fetch(formsUrl);
      if (!formsRes.ok) {
        const body = await formsRes.text();
        app.log.error(`[meta-lead-poller] Failed to fetch leadgen forms: ${formsRes.status} ${body}`);
        return;
      }

      const formsData = (await formsRes.json()) as MetaFormListResponse;
      const forms = formsData.data ?? [];
      app.log.info(`[meta-lead-poller] Found ${forms.length} leadgen form(s)`);

      if (forms.length === 0) return;

      const sinceTimestamp = Math.floor((Date.now() - LOOKBACK_MS) / 1000);
      let totalProcessed = 0;

      for (const form of forms) {
        try {
          // TODO: implement cursor-based pagination for high-volume forms
          const leadsUrl =
            `https://graph.facebook.com/v19.0/${encodeURIComponent(form.id)}/leads` +
            `?fields=field_data,created_time,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name` +
            `&since=${sinceTimestamp}` +
            `&limit=${LEADS_PER_FORM_LIMIT}` +
            `&access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN)}`;

          const leadsRes = await fetch(leadsUrl);
          if (!leadsRes.ok) {
            const body = await leadsRes.text();
            app.log.error(
              `[meta-lead-poller] Failed to fetch leads for form ${form.id}: ${leadsRes.status} ${body}`,
            );
            continue;
          }

          const leadsData = (await leadsRes.json()) as MetaLeadsResponse;
          const leads = leadsData.data ?? [];
          app.log.info(
            `[meta-lead-poller] Form ${form.id} (${form.name ?? 'unnamed'}): ${leads.length} lead(s) in window`,
          );

          for (const lead of leads) {
            await processLeadFromData(app, lead);
            totalProcessed++;
          }
        } catch (err) {
          app.log.error({ err }, `[meta-lead-poller] Error processing form ${form.id}`);
        }
      }

      app.log.info(`[meta-lead-poller] Poll cycle complete — ${totalProcessed} lead(s) processed`);
    } catch (err) {
      app.log.error({ err }, '[meta-lead-poller] Poll cycle failed');
    }
  }

  // Initial run after a short delay to let the server finish starting
  const initialTimeout = setTimeout(pollLeads, INITIAL_DELAY_MS);

  // Recurring poll
  const intervalId = setInterval(pollLeads, POLL_INTERVAL_MS);

  // Cleanup on server close
  app.addHook('onClose', async () => {
    clearTimeout(initialTimeout);
    clearInterval(intervalId);
  });
}

export default fp(metaLeadPollerPlugin, {
  name: 'meta-lead-poller',
});
