-- Audit logs migration — idempotent

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'archive', 'restore');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       audit_action NOT NULL,
  object_type  TEXT NOT NULL,
  object_id    UUID NOT NULL,
  diff         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_object_idx    ON audit_logs(object_type, object_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx      ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
