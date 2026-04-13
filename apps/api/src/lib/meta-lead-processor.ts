import type { FastifyInstance } from 'fastify';
import { eq, or, and, inArray } from 'drizzle-orm';
import {
  contacts,
  contactPropertyValues,
  deals,
  dealContacts,
  dealStageEvents,
  leadSubmissions,
  propertyDefinitions,
  stages,
} from '@crm/db';
import type { MetaLeadData } from './meta-lead.js';
import { env } from '../env.js';
import { normalizePhone } from './phone.js';
import { fetchLeadData, mapLeadFields } from './meta-lead.js';

/**
 * Process a lead from the Meta webhook — fetches lead data from the Graph API first.
 */
export async function processLeadFromWebhook(
  app: FastifyInstance,
  leadgenId: string,
  rawValue: unknown,
): Promise<void> {
  let submissionId: string | undefined;

  try {
    // Insert raw submission record immediately; skip if this leadgenId was already processed
    const [submission] = await app.db
      .insert(leadSubmissions)
      .values({
        leadgenId,
        source: 'meta',
        payloadRaw: rawValue as any,
        status: 'processed',
      })
      .onConflictDoNothing({ target: leadSubmissions.leadgenId })
      .returning({ id: leadSubmissions.id });

    if (!submission?.id) {
      app.log.info(`[meta-lead] Lead ${leadgenId} already processed — skipping duplicate`);
      return;
    }
    submissionId = submission.id;

    // Fetch lead data from Meta Graph API
    const leadData = await fetchLeadData(leadgenId, env.META_PAGE_ACCESS_TOKEN);

    // Extract form_id from the webhook payload
    const formId = (rawValue as { form_id?: string })?.form_id ?? undefined;

    await processLeadCore(app, leadData, submissionId, leadgenId, formId);
  } catch (err) {
    app.log.error({ err }, `[meta-lead] Failed to process lead ${leadgenId}`);
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

/**
 * Process a lead where the data is already available (used by the poller).
 */
export async function processLeadFromData(
  app: FastifyInstance,
  lead: MetaLeadData,
): Promise<void> {
  const leadgenId = lead.id;
  let submissionId: string | undefined;

  try {
    // Insert raw submission record; skip if this leadgenId was already processed
    const [submission] = await app.db
      .insert(leadSubmissions)
      .values({
        leadgenId,
        source: 'meta',
        payloadRaw: lead as any,
        status: 'processed',
      })
      .onConflictDoNothing({ target: leadSubmissions.leadgenId })
      .returning({ id: leadSubmissions.id });

    if (!submission?.id) {
      app.log.info(`[meta-lead] Lead ${leadgenId} already processed — skipping duplicate`);
      return;
    }
    submissionId = submission.id;

    await processLeadCore(app, lead, submissionId, leadgenId);
  } catch (err) {
    app.log.error({ err }, `[meta-lead] Failed to process lead ${leadgenId}`);
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

/**
 * Shared core: maps fields, upserts contact, creates deal.
 */
async function processLeadCore(
  app: FastifyInstance,
  leadData: MetaLeadData,
  submissionId: string,
  leadgenId: string,
  formId?: string,
): Promise<void> {
  const mapped = mapLeadFields(leadData.field_data);

  const phoneE164 = mapped.phoneE164 ? normalizePhone(mapped.phoneE164) : null;
  const mappedFields: Record<string, unknown> = {
    email: mapped.email,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    ...mapped.extraFields,
  };

  if (leadData.ad_id) mappedFields.ad_id = leadData.ad_id;
  if (leadData.adset_id) mappedFields.adset_id = leadData.adset_id;
  if (leadData.campaign_id) mappedFields.campaign_id = leadData.campaign_id;
  if (leadData.ad_name) mappedFields.ad_name = leadData.ad_name;
  if (leadData.adset_name) mappedFields.adset_name = leadData.adset_name;
  if (leadData.campaign_name) mappedFields.campaign_name = leadData.campaign_name;

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
    app.log.warn(`[meta-lead] Lead ${leadgenId} has no phone or email`);
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

  // Set UTM tracking and attribution contact properties
  const ATTR_PROPS: Array<{ first: string; last: string; value: string | undefined }> = [
    { first: 'first_lead_source', last: 'last_lead_source', value: 'meta_lead_ads' },
    { first: 'first_utm_source', last: 'last_utm_source', value: mapped.extraFields?.utm_source ?? 'facebook' },
    { first: 'first_utm_medium', last: 'last_utm_medium', value: mapped.extraFields?.utm_medium ?? 'paid_social' },
    {
      first: 'first_utm_campaign',
      last: 'last_utm_campaign',
      value: mapped.extraFields?.utm_campaign ?? leadData.campaign_name ?? undefined,
    },
    { first: 'first_meta_form', last: 'last_meta_form', value: formId },
    { first: 'first_meta_ad_id', last: 'last_meta_ad_id', value: leadData.ad_id },
    { first: 'first_meta_ad_name', last: 'last_meta_ad_name', value: leadData.ad_name },
    { first: 'first_meta_adset_id', last: 'last_meta_adset_id', value: leadData.adset_id },
    { first: 'first_meta_adset_name', last: 'last_meta_adset_name', value: leadData.adset_name },
    { first: 'first_meta_campaign_id', last: 'last_meta_campaign_id', value: leadData.campaign_id },
    {
      first: 'first_page_url',
      last: 'last_page_url',
      value: mapped.extraFields?.page_url ?? mapped.extraFields?.url ?? mapped.extraFields?.landing_page_url,
    },
  ];

  // Collect all property keys we need
  const allAttrKeys: string[] = [];
  for (const prop of ATTR_PROPS) {
    if (prop.value) {
      allAttrKeys.push(prop.first, prop.last);
    }
  }

  if (allAttrKeys.length > 0) {
    const attrPropDefs = await app.db
      .select({ id: propertyDefinitions.id, key: propertyDefinitions.key })
      .from(propertyDefinitions)
      .where(inArray(propertyDefinitions.key, allAttrKeys));

    const propDefByKey = new Map(attrPropDefs.map((p) => [p.key, p.id]));

    // Check which first_* properties already have values for this contact
    const firstPropDefIds = attrPropDefs
      .filter((p) => p.key.startsWith('first_'))
      .map((p) => p.id);

    const existingFirstValues = firstPropDefIds.length > 0
      ? await app.db
          .select({ propertyDefinitionId: contactPropertyValues.propertyDefinitionId })
          .from(contactPropertyValues)
          .where(
            and(
              eq(contactPropertyValues.contactId, contactId),
              inArray(contactPropertyValues.propertyDefinitionId, firstPropDefIds),
            ),
          )
      : [];

    const existingFirstPropIds = new Set(existingFirstValues.map((v) => v.propertyDefinitionId));

    for (const prop of ATTR_PROPS) {
      if (!prop.value) continue;

      // Always upsert last_*
      const lastPropId = propDefByKey.get(prop.last);
      if (lastPropId) {
        await app.db
          .insert(contactPropertyValues)
          .values({ contactId, propertyDefinitionId: lastPropId, value: prop.value })
          .onConflictDoUpdate({
            target: [contactPropertyValues.contactId, contactPropertyValues.propertyDefinitionId],
            set: { value: prop.value, updatedAt: new Date() },
          });
      }

      // Only set first_* if not already set
      const firstPropId = propDefByKey.get(prop.first);
      if (firstPropId && !existingFirstPropIds.has(firstPropId)) {
        await app.db
          .insert(contactPropertyValues)
          .values({ contactId, propertyDefinitionId: firstPropId, value: prop.value })
          .onConflictDoNothing();
      }
    }
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

  app.log.info(`[meta-lead] Lead ${leadgenId} processed: contact=${contactId} deal=${deal.id}`);
}
