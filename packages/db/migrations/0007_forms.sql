-- Forms module — idempotent

DO $$ BEGIN
  CREATE TYPE form_field_type AS ENUM ('text', 'email', 'phone', 'textarea', 'select', 'checkbox');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE form_status AS ENUM ('draft', 'active', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS forms (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  description          TEXT,
  status               form_status NOT NULL DEFAULT 'draft',
  submit_label         TEXT NOT NULL DEFAULT 'Enviar',
  success_message      TEXT NOT NULL DEFAULT 'Gràcies! Hem rebut el teu missatge.',
  created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS forms_status_idx ON forms(status);
CREATE INDEX IF NOT EXISTS forms_archived_at_idx ON forms(archived_at);

CREATE TABLE IF NOT EXISTS form_fields (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id                  UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  key                      TEXT NOT NULL,
  label                    TEXT NOT NULL,
  type                     form_field_type NOT NULL DEFAULT 'text',
  placeholder              TEXT,
  is_required              BOOLEAN NOT NULL DEFAULT false,
  position                 INTEGER NOT NULL DEFAULT 0,
  options                  JSONB DEFAULT '[]',
  crm_property_key         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, key)
);

CREATE INDEX IF NOT EXISTS form_fields_form_id_idx ON form_fields(form_id);

CREATE TABLE IF NOT EXISTS form_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id           UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  data              JSONB NOT NULL DEFAULT '{}',
  created_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source_url        TEXT,
  ip_hash           TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS form_submissions_form_id_idx ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS form_submissions_submitted_at_idx ON form_submissions(submitted_at);
