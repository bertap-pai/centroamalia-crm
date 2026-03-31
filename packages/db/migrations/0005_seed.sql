-- CRM Centro Amalia — Seed Data
-- Creates the default pipeline + stages and core property definitions.
-- Idempotent: uses INSERT ... ON CONFLICT DO NOTHING so safe to re-run.

-- ---------------------------------------------------------------------------
-- Default pipeline: Vendes
-- ---------------------------------------------------------------------------

INSERT INTO pipelines (id, name, slug, position)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Vendes',
  'vendes',
  0
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Default stages for pipeline "Vendes"
-- ---------------------------------------------------------------------------

INSERT INTO stages (id, pipeline_id, name, slug, position, is_closed_won, is_closed_lost)
VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Nou Lead',         'nou-lead',         0, FALSE, FALSE),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Contactat',        'contactat',        1, FALSE, FALSE),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Pressupost Enviat','pressupost-enviat', 2, FALSE, FALSE),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Tancat Guanyat',   'tancat-guanyat',   3, TRUE,  FALSE),
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Tancat Perdut',    'tancat-perdut',    4, FALSE, TRUE)
ON CONFLICT (pipeline_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Core property definitions
-- ---------------------------------------------------------------------------

-- Servei d'interès (contact)
INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES (
  '00000000-0000-0000-0002-000000000001',
  'servei_interes',
  'Servei d''interès',
  'contact',
  'select',
  '[]',
  FALSE,
  'aa'
)
ON CONFLICT (key) DO NOTHING;

-- Font del lead (contact)
INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES (
  '00000000-0000-0000-0002-000000000002',
  'last_lead_source',
  'Font del lead',
  'contact',
  'select',
  '[{"key":"web","label":"Web"},{"key":"meta","label":"Meta (Instagram/Facebook)"},{"key":"tiktok","label":"TikTok"},{"key":"referral","label":"Recomanació"},{"key":"walk_in","label":"Walk-in"},{"key":"other","label":"Altres"}]',
  FALSE,
  'ab'
)
ON CONFLICT (key) DO NOTHING;

-- Observacions (contact + deal)
INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES (
  '00000000-0000-0000-0002-000000000003',
  'observacions',
  'Observacions',
  'both',
  'textarea',
  '[]',
  FALSE,
  'ac'
)
ON CONFLICT (key) DO NOTHING;

-- Data de seguiment (contact)
INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES (
  '00000000-0000-0000-0002-000000000004',
  'data_seguiment',
  'Data de seguiment',
  'contact',
  'date',
  '[]',
  FALSE,
  'ad'
)
ON CONFLICT (key) DO NOTHING;
