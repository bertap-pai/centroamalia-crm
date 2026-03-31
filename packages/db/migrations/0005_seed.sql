-- CRM Centro Amalia — Seed Data
-- Creates the 3 default pipelines + stages and all core property definitions.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING — safe to re-run.

-- ===========================================================================
-- PIPELINES & STAGES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Pipeline 1: Leads
-- ---------------------------------------------------------------------------

INSERT INTO pipelines (id, name, slug, position)
VALUES ('00000000-0000-0000-0000-000000000001', 'Leads', 'leads', 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stages (id, pipeline_id, name, slug, position, is_closed_won, is_closed_lost, required_fields)
VALUES
  ('00000000-0000-0000-0001-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Nou Lead', 'nou-lead', 0, FALSE, FALSE, '[]'),

  ('00000000-0000-0000-0001-000000000002',
   '00000000-0000-0000-0000-000000000001',
   '1r intent — sense resposta', '1r-intent', 1, FALSE, FALSE,
   '["owner_user_id","interaction_channel"]'),

  ('00000000-0000-0000-0001-000000000003',
   '00000000-0000-0000-0000-000000000001',
   '2n intent — sense resposta', '2n-intent', 2, FALSE, FALSE,
   '["owner_user_id","interaction_channel"]'),

  ('00000000-0000-0000-0001-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'Interactuat — sense next step', 'interactuat-sense-next-step', 3, FALSE, FALSE,
   '["owner_user_id"]'),

  ('00000000-0000-0000-0001-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'Interactuat — trucada agendada', 'interactuat-trucada-agendada', 4, FALSE, FALSE,
   '["owner_user_id","call_scheduled_at"]'),

  ('00000000-0000-0000-0001-000000000006',
   '00000000-0000-0000-0000-000000000001',
   'Pendent d''agendar visita', 'pendent-agendar', 5, FALSE, FALSE,
   '["owner_user_id","next_step_due_at"]'),

  ('00000000-0000-0000-0001-000000000007',
   '00000000-0000-0000-0000-000000000001',
   '1a visita agendada', 'visita-agendada', 6, FALSE, FALSE,
   '["owner_user_id","visit_datetime"]'),

  ('00000000-0000-0000-0001-000000000008',
   '00000000-0000-0000-0000-000000000001',
   'Actiu en tractament', 'actiu-tractament', 7, FALSE, FALSE,
   '["owner_user_id","treatment_start_at"]'),

  ('00000000-0000-0000-0001-000000000009',
   '00000000-0000-0000-0000-000000000001',
   'Perdut — mai ha estat actiu', 'perdut', 8, FALSE, TRUE,
   '["owner_user_id","lost_reason"]')

ON CONFLICT (pipeline_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Pipeline 2: Pacients
-- ---------------------------------------------------------------------------

INSERT INTO pipelines (id, name, slug, position)
VALUES ('00000000-0000-0000-0000-000000000002', 'Pacients', 'pacients', 1)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stages (id, pipeline_id, name, slug, position, is_closed_won, is_closed_lost, required_fields)
VALUES
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0000-000000000002',
   'Actiu', 'actiu', 0, FALSE, FALSE,
   '["treatment_start_at"]'),

  ('00000000-0000-0000-0002-000000000002',
   '00000000-0000-0000-0000-000000000002',
   'Alta', 'alta', 1, TRUE, FALSE,
   '["discharge_at"]'),

  ('00000000-0000-0000-0002-000000000003',
   '00000000-0000-0000-0000-000000000002',
   'Churn', 'churn', 2, FALSE, TRUE,
   '["churn_at","churn_reason"]')

ON CONFLICT (pipeline_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Pipeline 3: BD (Business Development)
-- ---------------------------------------------------------------------------

INSERT INTO pipelines (id, name, slug, position)
VALUES ('00000000-0000-0000-0000-000000000003', 'BD', 'bd', 2)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stages (id, pipeline_id, name, slug, position, is_closed_won, is_closed_lost, required_fields)
VALUES
  ('00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-0000-000000000003',
   'Nou', 'nou', 0, FALSE, FALSE, '[]'),

  ('00000000-0000-0000-0003-000000000002',
   '00000000-0000-0000-0000-000000000003',
   'Intentant contactar', 'intentant-contactar', 1, FALSE, FALSE, '[]'),

  ('00000000-0000-0000-0003-000000000003',
   '00000000-0000-0000-0000-000000000003',
   'Primer contacte', 'primer-contacte', 2, FALSE, FALSE, '[]'),

  ('00000000-0000-0000-0003-000000000004',
   '00000000-0000-0000-0000-000000000003',
   'En negociació', 'en-negociacio', 3, FALSE, FALSE,
   '["next_step_due_at"]'),

  ('00000000-0000-0000-0003-000000000005',
   '00000000-0000-0000-0000-000000000003',
   'Won', 'won', 4, TRUE, FALSE, '[]'),

  ('00000000-0000-0000-0003-000000000006',
   '00000000-0000-0000-0000-000000000003',
   'Lost', 'lost', 5, FALSE, TRUE,
   '["lost_reason"]')

ON CONFLICT (pipeline_id, slug) DO NOTHING;


-- ===========================================================================
-- PROPERTY DEFINITIONS
-- ===========================================================================

-- ── Contact properties ──────────────────────────────────────────────────────

INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES
  ('00000000-0000-0000-0010-000000000001',
   'servei_interes', 'Servei d''interès', 'contact', 'select', '[]', FALSE, 'aa'),

  ('00000000-0000-0000-0010-000000000002',
   'first_lead_source', 'Font del lead (1r)', 'contact', 'select',
   '[{"key":"web","label":"Web"},{"key":"meta","label":"Meta"},{"key":"tiktok","label":"TikTok"},{"key":"referral","label":"Recomanació"},{"key":"walk_in","label":"Walk-in"},{"key":"other","label":"Altres"}]',
   FALSE, 'ab'),

  ('00000000-0000-0000-0010-000000000003',
   'last_lead_source', 'Font del lead (última)', 'contact', 'select',
   '[{"key":"web","label":"Web"},{"key":"meta","label":"Meta"},{"key":"tiktok","label":"TikTok"},{"key":"referral","label":"Recomanació"},{"key":"walk_in","label":"Walk-in"},{"key":"other","label":"Altres"}]',
   FALSE, 'ac'),

  ('00000000-0000-0000-0010-000000000004',
   'first_meta_form', 'Meta form (1r)', 'contact', 'text', '[]', FALSE, 'ad'),

  ('00000000-0000-0000-0010-000000000005',
   'last_meta_form', 'Meta form (últim)', 'contact', 'text', '[]', FALSE, 'ae'),

  ('00000000-0000-0000-0010-000000000006',
   'first_page_url', 'URL pàgina (1a)', 'contact', 'text', '[]', FALSE, 'af'),

  ('00000000-0000-0000-0010-000000000007',
   'last_page_url', 'URL pàgina (última)', 'contact', 'text', '[]', FALSE, 'ag'),

  ('00000000-0000-0000-0010-000000000008',
   'first_utm_source', 'UTM source (1r)', 'contact', 'text', '[]', FALSE, 'ah'),

  ('00000000-0000-0000-0010-000000000009',
   'last_utm_source', 'UTM source (últim)', 'contact', 'text', '[]', FALSE, 'ai'),

  ('00000000-0000-0000-0010-000000000010',
   'first_utm_campaign', 'UTM campaign (1a)', 'contact', 'text', '[]', FALSE, 'aj'),

  ('00000000-0000-0000-0010-000000000011',
   'last_utm_campaign', 'UTM campaign (última)', 'contact', 'text', '[]', FALSE, 'ak'),

  ('00000000-0000-0000-0010-000000000012',
   'first_utm_medium', 'UTM medium (1r)', 'contact', 'text', '[]', FALSE, 'al'),

  ('00000000-0000-0000-0010-000000000013',
   'last_utm_medium', 'UTM medium (últim)', 'contact', 'text', '[]', FALSE, 'am'),

  ('00000000-0000-0000-0010-000000000014',
   'first_submission_at', 'Primera submission', 'contact', 'datetime', '[]', FALSE, 'an'),

  ('00000000-0000-0000-0010-000000000015',
   'last_submission_at', 'Última submission', 'contact', 'datetime', '[]', FALSE, 'ao'),

  ('00000000-0000-0000-0010-000000000016',
   'last_aircall_call_outcome', 'Aircall — resultat última trucada', 'contact', 'text', '[]', FALSE, 'ap'),

  ('00000000-0000-0000-0010-000000000017',
   'last_aircall_call_timestamp', 'Aircall — data última trucada', 'contact', 'datetime', '[]', FALSE, 'aq'),

  ('00000000-0000-0000-0010-000000000018',
   'last_aircall_sms_direction', 'Aircall — direcció últim SMS', 'contact', 'text', '[]', FALSE, 'ar'),

  ('00000000-0000-0000-0010-000000000019',
   'last_aircall_sms_timestamp', 'Aircall — data últim SMS', 'contact', 'datetime', '[]', FALSE, 'as'),

  ('00000000-0000-0000-0010-000000000020',
   'last_used_aircall_phone_number', 'Aircall — telèfon agent', 'contact', 'text', '[]', FALSE, 'at'),

  ('00000000-0000-0000-0010-000000000021',
   'last_used_aircall_tags', 'Aircall — tags', 'contact', 'text', '[]', FALSE, 'au')

ON CONFLICT (key) DO NOTHING;

-- ── Deal properties ─────────────────────────────────────────────────────────

INSERT INTO property_definitions (id, key, label, scope, type, options, is_required, position)
VALUES
  ('00000000-0000-0000-0020-000000000001',
   'title', 'Títol del deal', 'deal', 'text', '[]', FALSE, 'ba'),

  ('00000000-0000-0000-0020-000000000002',
   'lost_reason', 'Motiu de pèrdua', 'deal', 'select',
   '[{"key":"price","label":"Preu"},{"key":"competitor","label":"Competidor"},{"key":"no_interest","label":"Sense interès"},{"key":"no_response","label":"Sense resposta"},{"key":"other","label":"Altres"}]',
   FALSE, 'bb'),

  ('00000000-0000-0000-0020-000000000003',
   'interaction_channel', 'Canal d''interacció', 'deal', 'select',
   '[{"key":"phone","label":"Telèfon"},{"key":"whatsapp","label":"WhatsApp"},{"key":"email","label":"Email"},{"key":"in_person","label":"En persona"},{"key":"other","label":"Altres"}]',
   FALSE, 'bc'),

  ('00000000-0000-0000-0020-000000000004',
   'next_step', 'Proper pas', 'deal', 'text', '[]', FALSE, 'bd'),

  ('00000000-0000-0000-0020-000000000005',
   'next_step_due_at', 'Data proper pas', 'deal', 'date', '[]', FALSE, 'be'),

  ('00000000-0000-0000-0020-000000000006',
   'call_scheduled_at', 'Data trucada agendada', 'deal', 'datetime', '[]', FALSE, 'bf'),

  ('00000000-0000-0000-0020-000000000007',
   'visit_datetime', 'Data i hora visita', 'deal', 'datetime', '[]', FALSE, 'bg'),

  ('00000000-0000-0000-0020-000000000008',
   'treatment_start_at', 'Inici tractament', 'deal', 'date', '[]', FALSE, 'bh'),

  ('00000000-0000-0000-0020-000000000009',
   'discharge_at', 'Data alta', 'deal', 'date', '[]', FALSE, 'bi'),

  ('00000000-0000-0000-0020-000000000010',
   'churn_at', 'Data churn', 'deal', 'date', '[]', FALSE, 'bj'),

  ('00000000-0000-0000-0020-000000000011',
   'churn_reason', 'Motiu churn', 'deal', 'select',
   '[{"key":"price","label":"Preu"},{"key":"service","label":"Qualitat servei"},{"key":"moved","label":"Canvi de residència"},{"key":"competitor","label":"Competidor"},{"key":"other","label":"Altres"}]',
   FALSE, 'bk'),

  ('00000000-0000-0000-0020-000000000012',
   'observacions', 'Observacions', 'both', 'textarea', '[]', FALSE, 'bl')

ON CONFLICT (key) DO NOTHING;
