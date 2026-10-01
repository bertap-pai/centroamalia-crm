ALTER TABLE "booking_imports" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'confirmed';
ALTER TABLE "booking_imports" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz;
ALTER TABLE "booking_imports" ADD COLUMN IF NOT EXISTS "current_provider_booking_id" text;
UPDATE "booking_imports" SET "current_provider_booking_id" = "provider_booking_id" WHERE "current_provider_booking_id" IS NULL;
ALTER TABLE "booking_imports" ALTER COLUMN "current_provider_booking_id" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "booking_aliases" (
  "provider_booking_id" text PRIMARY KEY,
  "booking_import_id" uuid NOT NULL REFERENCES "booking_imports"("id") ON DELETE CASCADE
);
INSERT INTO "booking_aliases" ("provider_booking_id", "booking_import_id")
SELECT "provider_booking_id", "id" FROM "booking_imports" ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "booking_status_events" (
  "event_id" text PRIMARY KEY,
  "provider_booking_id" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('canceled', 'moved')),
  "occurred_at" timestamptz NOT NULL,
  "new_provider_booking_id" text,
  "new_starts_at" timestamptz,
  "payload_hash" text NOT NULL,
  "resolution" text NOT NULL DEFAULT 'pending' CHECK ("resolution" IN ('pending', 'applied', 'stale', 'conflict')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "booking_status_events_booking_idx" ON "booking_status_events" ("provider_booking_id", "occurred_at");
