-- Server heartbeat tracking for downtime detection
CREATE TABLE IF NOT EXISTS server_heartbeats (
  id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
