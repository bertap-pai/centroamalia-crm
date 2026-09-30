CREATE TABLE IF NOT EXISTS "booking_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_booking_id" text NOT NULL UNIQUE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT,
  "deal_id" uuid REFERENCES "deals"("id") ON DELETE SET NULL,
  "service" text NOT NULL,
  "professional" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "source" text,
  "attribution" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_test" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "booking_imports_contact_idx" ON "booking_imports" ("contact_id");
CREATE INDEX IF NOT EXISTS "booking_imports_deal_idx" ON "booking_imports" ("deal_id");
