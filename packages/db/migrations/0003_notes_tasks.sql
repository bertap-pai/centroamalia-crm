-- Notes and tasks migration — idempotent

DO $$ BEGIN
  CREATE TYPE object_type AS ENUM ('contact', 'deal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('open', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type          object_type NOT NULL,
  object_id            UUID NOT NULL,
  body                 TEXT NOT NULL,
  created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at          TIMESTAMPTZ,
  archived_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS notes_object_idx ON notes(object_type, object_id);

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
