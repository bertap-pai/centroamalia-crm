CREATE TABLE lists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  object_type         TEXT NOT NULL CHECK (object_type IN ('contact', 'deal')),
  kind                TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'dynamic')),
  criteria            JSONB,
  is_team             BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id  UUID REFERENCES users(id),
  archived_at         TIMESTAMPTZ,
  archived_by_user_id UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lists_object_type_idx ON lists(object_type);
CREATE INDEX lists_archived_at_idx ON lists(archived_at);

CREATE TABLE list_memberships (
  list_id          UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  object_id        UUID NOT NULL,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by_user_id UUID REFERENCES users(id),
  PRIMARY KEY (list_id, object_id)
);
CREATE INDEX list_memberships_list_idx   ON list_memberships(list_id);
CREATE INDEX list_memberships_object_idx ON list_memberships(object_id);
