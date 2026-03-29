-- CRM Centro Amalia — Initial Schema Migration
-- Run via: pnpm db:migrate
-- Idempotent (uses CREATE IF NOT EXISTS / IF NOT EXISTS patterns)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE property_scope AS ENUM ('contact', 'deal', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE property_type AS ENUM (
    'text', 'textarea', 'number', 'boolean',
    'date', 'datetime', 'select', 'multiselect'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE deal_stage_event_source AS ENUM ('ui', 'api', 'import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE object_type AS ENUM ('contact', 'deal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('open', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_submission_source AS ENUM ('web', 'meta', 'tiktok', 'import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_submission_status AS ENUM ('processed', 'failed', 'needs_review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE external_identifier_object_type AS ENUM ('contact', 'deal', 'submission');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE saved_view_object_type AS ENUM ('contact', 'deal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'user',
  google_id       TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contacts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                  TEXT UNIQUE,          -- E.164, +34 default; nullable for secondary contacts
  first_name                  TEXT,
  last_name                   TEXT,
  email                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  archived_at                 TIMESTAMPTZ,
  archived_by_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  possible_identity_mismatch  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS contacts_phone_idx       ON contacts(phone_e164);
CREATE INDEX IF NOT EXISTS contacts_archived_at_idx ON contacts(archived_at);

-- ---------------------------------------------------------------------------
-- pipelines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- stages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id      UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  is_closed_won    BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed_lost   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Array of property keys required before entering this stage
  required_fields  JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pipeline_id, slug)
);

CREATE INDEX IF NOT EXISTS stages_pipeline_idx ON stages(pipeline_id);

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id              UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  stage_id                 UUID NOT NULL REFERENCES stages(id)    ON DELETE RESTRICT,
  owner_user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalised from stage for fast filtering
  is_closed_won            BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed_lost           BOOLEAN NOT NULL DEFAULT FALSE,
  current_stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  archived_at              TIMESTAMPTZ,
  archived_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS deals_pipeline_idx    ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx       ON deals(stage_id);
CREATE INDEX IF NOT EXISTS deals_owner_idx       ON deals(owner_user_id);
CREATE INDEX IF NOT EXISTS deals_archived_at_idx ON deals(archived_at);
CREATE INDEX IF NOT EXISTS deals_created_at_idx  ON deals(created_at);

-- ---------------------------------------------------------------------------
-- deal_contacts  (M-N; exactly one is_primary per deal enforced by partial unique index)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deal_contacts (
  deal_id     UUID NOT NULL REFERENCES deals(id)    ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role        TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, contact_id)
);

CREATE INDEX IF NOT EXISTS deal_contacts_deal_idx    ON deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS deal_contacts_contact_idx ON deal_contacts(contact_id);

-- Enforce: at most one primary contact per deal
CREATE UNIQUE INDEX IF NOT EXISTS deal_contacts_primary_uniq
  ON deal_contacts(deal_id)
  WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- deal_stage_events  (immutable audit log)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            UUID NOT NULL REFERENCES deals(id)     ON DELETE CASCADE,
  pipeline_id        UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  from_stage_id      UUID REFERENCES stages(id)             ON DELETE RESTRICT,  -- NULL for first event
  to_stage_id        UUID NOT NULL REFERENCES stages(id)    ON DELETE RESTRICT,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source             deal_stage_event_source NOT NULL DEFAULT 'ui'
);

CREATE INDEX IF NOT EXISTS deal_stage_events_deal_idx       ON deal_stage_events(deal_id);
CREATE INDEX IF NOT EXISTS deal_stage_events_changed_at_idx ON deal_stage_events(changed_at);

-- ---------------------------------------------------------------------------
-- property_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS property_definitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  scope            property_scope NOT NULL,
  type             property_type NOT NULL,
  options          JSONB DEFAULT '[]',       -- [{ key, label }] for select/multiselect
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  is_internal_only BOOLEAN NOT NULL DEFAULT FALSE,
  is_sensitive     BOOLEAN NOT NULL DEFAULT FALSE,
  position         TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_definitions_scope_idx ON property_definitions(scope);

-- ---------------------------------------------------------------------------
-- contact_property_values
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contact_property_values (
  contact_id             UUID NOT NULL REFERENCES contacts(id)             ON DELETE CASCADE,
  property_definition_id UUID NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  value                  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, property_definition_id)
);

CREATE INDEX IF NOT EXISTS contact_property_values_contact_idx ON contact_property_values(contact_id);

-- ---------------------------------------------------------------------------
-- deal_property_values
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deal_property_values (
  deal_id                UUID NOT NULL REFERENCES deals(id)                ON DELETE CASCADE,
  property_definition_id UUID NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  value                  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, property_definition_id)
);

CREATE INDEX IF NOT EXISTS deal_property_values_deal_idx ON deal_property_values(deal_id);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type         object_type NOT NULL,
  object_id           UUID NOT NULL,
  body                TEXT NOT NULL,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ,
  archived_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS notes_object_idx ON notes(object_type, object_id);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type          object_type NOT NULL,
  object_id            UUID NOT NULL,
  title                TEXT NOT NULL,
  due_at               TIMESTAMPTZ,
  status               task_status NOT NULL DEFAULT 'open',
  assigned_to_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at          TIMESTAMPTZ,
  archived_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS tasks_object_idx ON tasks(object_type, object_id);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks(due_at);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);

-- ---------------------------------------------------------------------------
-- lead_submissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              lead_submission_source NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_raw         JSONB NOT NULL,
  mapped_phone_e164   TEXT,
  mapped_fields       JSONB,
  created_contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_deal_id     UUID REFERENCES deals(id)    ON DELETE SET NULL,
  status              lead_submission_status NOT NULL DEFAULT 'processed',
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS lead_submissions_status_idx      ON lead_submissions(status);
CREATE INDEX IF NOT EXISTS lead_submissions_received_at_idx ON lead_submissions(received_at);
CREATE INDEX IF NOT EXISTS lead_submissions_contact_idx     ON lead_submissions(created_contact_id);

-- ---------------------------------------------------------------------------
-- external_identifiers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_identifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type  external_identifier_object_type NOT NULL,
  object_id    UUID NOT NULL,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id, object_type)
);

CREATE INDEX IF NOT EXISTS external_identifiers_object_idx ON external_identifiers(object_type, object_id);

-- ---------------------------------------------------------------------------
-- saved_views
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_views (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  object_type        saved_view_object_type NOT NULL,
  config             JSONB NOT NULL,
  is_team            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saved_views_user_idx ON saved_views(created_by_user_id);
CREATE INDEX IF NOT EXISTS saved_views_team_idx ON saved_views(is_team, object_type);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on users, contacts, deals, property_definitions, saved_views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER property_definitions_updated_at BEFORE UPDATE ON property_definitions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER saved_views_updated_at BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
