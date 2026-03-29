/**
 * Seed script — idempotent (safe to re-run).
 * Creates pipelines, stages, and initial property definitions per the spec.
 */
import { createDb, pipelines, stages, propertyDefinitions } from './index.js';
import { sql } from 'drizzle-orm';

const CONNECTION_STRING =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/crm';

const db = createDb(CONNECTION_STRING);

// ---------------------------------------------------------------------------
// Pipelines & Stages
// ---------------------------------------------------------------------------

const PIPELINES = [
  {
    slug: 'leads',
    name: 'Leads',
    position: 0,
    stages: [
      { slug: 'new', name: 'New', position: 0, requiredFields: [] },
      { slug: '1er_intent', name: '1er intent pero sense resposta', position: 1, requiredFields: ['interaction_channel'] },
      { slug: '2a_intent', name: '2a intent pero sense resposta', position: 2, requiredFields: ['interaction_channel'] },
      { slug: 'interactuat_sense_next', name: 'Interactuat pero sense next step', position: 3, requiredFields: [] },
      { slug: 'interactuat_trucada', name: 'Interactuat amb trucada agend', position: 4, requiredFields: ['call_scheduled_at'] },
      { slug: 'pendents_agendar', name: "Pendents d'agendar", position: 5, requiredFields: ['next_step_due_at'] },
      { slug: 'visita_agendada', name: 'la visita agendada', position: 6, requiredFields: ['visit_datetime'] },
      { slug: 'actiu_tractament', name: 'Actiu en tractament', position: 7, requiredFields: ['treatment_start_at'] },
      {
        slug: 'perdut',
        name: 'Perdut - mai ha estat actiu',
        position: 8,
        requiredFields: ['lost_reason'],
        isClosedLost: true,
      },
    ],
  },
  {
    slug: 'pacients',
    name: 'Pacients',
    position: 1,
    stages: [
      { slug: 'actiu', name: 'Actiu', position: 0, requiredFields: ['treatment_start_at'] },
      { slug: 'alta', name: 'Alta', position: 1, requiredFields: ['discharge_at'] },
      { slug: 'churn', name: 'Churn', position: 2, requiredFields: ['churn_at', 'churn_reason'], isClosedLost: true },
    ],
  },
  {
    slug: 'bd',
    name: 'BD',
    position: 2,
    stages: [
      { slug: 'nou', name: 'Nou', position: 0, requiredFields: [] },
      { slug: 'intentant_contactar', name: 'Intentant contactar', position: 1, requiredFields: [] },
      { slug: 'primer_contacte', name: 'Primer contacte', position: 2, requiredFields: [] },
      { slug: 'en_negociacio', name: 'En negociacio', position: 3, requiredFields: ['next_step_due_at'] },
      { slug: 'won', name: 'Won', position: 4, requiredFields: [], isClosedWon: true },
      { slug: 'lost', name: 'Lost', position: 5, requiredFields: ['lost_reason'], isClosedLost: true },
    ],
  },
] satisfies Array<{
  slug: string;
  name: string;
  position: number;
  stages: Array<{
    slug: string;
    name: string;
    position: number;
    requiredFields: string[];
    isClosedWon?: boolean;
    isClosedLost?: boolean;
  }>;
}>;

// ---------------------------------------------------------------------------
// Property Definitions
// ---------------------------------------------------------------------------

type PropDef = {
  key: string;
  label: string;
  scope: 'contact' | 'deal' | 'both';
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multiselect';
  options?: Array<{ key: string; label: string }>;
  isRequired?: boolean;
  isInternalOnly?: boolean;
  isSensitive?: boolean;
};

const PROPERTY_DEFINITIONS: PropDef[] = [
  // ---- Contact base ----
  { key: 'first_name', label: 'First name', scope: 'contact', type: 'text' },
  { key: 'last_name', label: 'Last name', scope: 'contact', type: 'text' },
  { key: 'email', label: 'Email', scope: 'contact', type: 'text' },
  { key: 'phone_e164', label: 'Phone', scope: 'contact', type: 'text' },
  { key: 'servei_interes', label: 'Servei interès', scope: 'contact', type: 'text' },

  // ---- Contact attribution ----
  {
    key: 'first_lead_source', label: 'First lead source', scope: 'contact', type: 'select',
    options: [
      { key: 'unknown', label: 'Desconegut' },
      { key: 'meta_lead_ads', label: 'Meta (Lead Ads)' },
      { key: 'tiktok_lead_gen', label: 'TikTok (Lead Gen)' },
      { key: 'website_form', label: 'Formulari web' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'referral', label: 'Referit / boca-orella' },
      { key: 'phone_inbound', label: 'Trucada entrant' },
      { key: 'walk_in', label: 'Presencial' },
      { key: 'other', label: 'Altres' },
    ],
  },
  {
    key: 'last_lead_source', label: 'Last lead source', scope: 'contact', type: 'select',
    options: [
      { key: 'unknown', label: 'Desconegut' },
      { key: 'meta_lead_ads', label: 'Meta (Lead Ads)' },
      { key: 'tiktok_lead_gen', label: 'TikTok (Lead Gen)' },
      { key: 'website_form', label: 'Formulari web' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'referral', label: 'Referit / boca-orella' },
      { key: 'phone_inbound', label: 'Trucada entrant' },
      { key: 'walk_in', label: 'Presencial' },
      { key: 'other', label: 'Altres' },
    ],
  },
  { key: 'first_meta_form', label: 'First meta form', scope: 'contact', type: 'text' },
  { key: 'last_meta_form', label: 'Last meta form', scope: 'contact', type: 'text' },
  { key: 'first_page_url', label: 'First page URL', scope: 'contact', type: 'text' },
  { key: 'last_page_url', label: 'Last page URL', scope: 'contact', type: 'text' },
  { key: 'first_utm_source', label: 'First UTM source', scope: 'contact', type: 'text' },
  { key: 'last_utm_source', label: 'Last UTM source', scope: 'contact', type: 'text' },
  { key: 'first_utm_campaign', label: 'First UTM campaign', scope: 'contact', type: 'text' },
  { key: 'last_utm_campaign', label: 'Last UTM campaign', scope: 'contact', type: 'text' },
  { key: 'first_utm_medium', label: 'First UTM medium', scope: 'contact', type: 'text' },
  { key: 'last_utm_medium', label: 'Last UTM medium', scope: 'contact', type: 'text' },
  { key: 'first_submission_at', label: 'First submission at', scope: 'contact', type: 'datetime' },
  { key: 'last_submission_at', label: 'Last submission at', scope: 'contact', type: 'datetime' },

  // ---- Contact Aircall ----
  {
    key: 'last_aircall_call_outcome', label: 'Last Aircall call outcome', scope: 'contact', type: 'select',
    options: [
      { key: 'answered', label: 'Contestada' },
      { key: 'no_answer', label: 'Sense resposta' },
      { key: 'busy', label: 'Ocupat' },
      { key: 'voicemail', label: 'Bústia de veu' },
      { key: 'failed', label: 'Fallida' },
      { key: 'other', label: 'Altres' },
    ],
  },
  { key: 'last_aircall_call_timestamp', label: 'Last Aircall call timestamp', scope: 'contact', type: 'datetime' },
  { key: 'last_aircall_sms_direction', label: 'Last Aircall SMS direction', scope: 'contact', type: 'text' },
  { key: 'last_aircall_sms_timestamp', label: 'Last Aircall SMS timestamp', scope: 'contact', type: 'datetime' },
  { key: 'last_used_aircall_phone_number', label: 'Last Aircall phone number', scope: 'contact', type: 'text' },
  { key: 'last_used_aircall_tags', label: 'Last Aircall tags', scope: 'contact', type: 'textarea' },

  // ---- Deal properties ----
  { key: 'title', label: 'Title', scope: 'deal', type: 'text' },
  {
    key: 'lost_reason', label: 'Lost reason', scope: 'deal', type: 'select',
    options: [
      { key: 'no_response', label: 'Sense resposta' },
      { key: 'not_interested', label: 'No interessat/da' },
      { key: 'price', label: 'Preu' },
      { key: 'schedule', label: 'Horaris / no pot agendar' },
      { key: 'competitor', label: 'Ha triat una altra opció' },
      { key: 'invalid_contact', label: 'Contacte incorrecte / dades errònies' },
      { key: 'duplicate', label: 'Duplicat' },
      { key: 'other', label: 'Altres' },
    ],
  },
  {
    key: 'interaction_channel', label: 'Interaction channel', scope: 'deal', type: 'select',
    options: [
      { key: 'unknown', label: 'Desconegut' },
      { key: 'call', label: 'Trucada' },
      { key: 'sms', label: 'SMS' },
      { key: 'whatsapp', label: 'WhatsApp' },
      { key: 'email', label: 'Email' },
      { key: 'in_person', label: 'Presencial' },
      { key: 'other', label: 'Altres' },
    ],
  },
  { key: 'next_step', label: 'Next step', scope: 'deal', type: 'text' },
  { key: 'next_step_due_at', label: 'Next step due at', scope: 'deal', type: 'datetime' },
  { key: 'call_scheduled_at', label: 'Call scheduled at', scope: 'deal', type: 'datetime' },
  { key: 'visit_datetime', label: 'Visit datetime', scope: 'deal', type: 'datetime' },
  { key: 'treatment_start_at', label: 'Treatment start at', scope: 'deal', type: 'datetime' },
  { key: 'discharge_at', label: 'Discharge at', scope: 'deal', type: 'datetime' },
  { key: 'churn_at', label: 'Churn at', scope: 'deal', type: 'datetime' },
  {
    key: 'churn_reason', label: 'Churn reason', scope: 'deal', type: 'select',
    options: [
      { key: 'no_show', label: 'No es presenta / abandona' },
      { key: 'time_constraints', label: 'Falta de temps' },
      { key: 'financial', label: 'Motiu econòmic' },
      { key: 'not_improving', label: 'No millora / no veu resultats' },
      { key: 'unsatisfied', label: 'Insatisfacció amb el servei' },
      { key: 'moved', label: 'Canvi de ciutat' },
      { key: 'medical', label: 'Motiu mèdic / contraindicació' },
      { key: 'other', label: 'Altres' },
    ],
  },

  // ---- Consultation reason (contact or deal, sensitive) ----
  {
    key: 'consult_reason_code', label: 'Motiu de consulta', scope: 'both', type: 'select',
    isSensitive: true,
    options: [
      { key: 'pain_discomfort', label: 'Dolor / molèsties' },
      { key: 'injury_recovery', label: 'Lesió / recuperació' },
      { key: 'mobility_function', label: 'Mobilitat / funcionalitat' },
      { key: 'performance_training', label: 'Rendiment / entrenament' },
      { key: 'post_surgery', label: 'Postoperatori' },
      { key: 'prevention', label: 'Prevenció / manteniment' },
      { key: 'administrative', label: 'Consulta administrativa (preus, horaris, dubtes)' },
      { key: 'other', label: 'Altres' },
    ],
  },
  {
    key: 'consult_reason_notes', label: 'Motiu de consulta (notes)', scope: 'both',
    type: 'textarea', isSensitive: true,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  console.log('Seeding pipelines and stages...');

  for (const p of PIPELINES) {
    const [pipeline] = await db
      .insert(pipelines)
      .values({ name: p.name, slug: p.slug, position: p.position })
      .onConflictDoUpdate({ target: pipelines.slug, set: { name: p.name, position: p.position } })
      .returning();

    if (!pipeline) throw new Error(`Failed to upsert pipeline: ${p.slug}`);

    for (const s of p.stages) {
      await db
        .insert(stages)
        .values({
          pipelineId: pipeline.id,
          name: s.name,
          slug: s.slug,
          position: s.position,
          requiredFields: s.requiredFields,
          isClosedWon: s.isClosedWon ?? false,
          isClosedLost: s.isClosedLost ?? false,
        })
        .onConflictDoNothing();
    }
  }

  console.log('Seeding property definitions...');

  for (const def of PROPERTY_DEFINITIONS) {
    await db
      .insert(propertyDefinitions)
      .values({
        key: def.key,
        label: def.label,
        scope: def.scope,
        type: def.type,
        options: def.options ?? [],
        isRequired: def.isRequired ?? false,
        isInternalOnly: def.isInternalOnly ?? false,
        isSensitive: def.isSensitive ?? false,
      })
      .onConflictDoUpdate({
        target: propertyDefinitions.key,
        set: {
          label: def.label,
          options: def.options ?? [],
          isSensitive: def.isSensitive ?? false,
        },
      });
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
