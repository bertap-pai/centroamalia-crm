CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(50) NOT NULL,
  priority      VARCHAR(20) NOT NULL DEFAULT 'normal',
  title         VARCHAR(255) NOT NULL,
  body          TEXT,
  entity_type   VARCHAR(50) NOT NULL,
  entity_id     UUID NOT NULL,
  read_at       TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_dismissed_created_idx
  ON notifications(user_id, dismissed_at, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_read_idx
  ON notifications(user_id, read_at);
