UPDATE property_definitions
SET options = COALESCE(options, '[]'::jsonb)
  || '[{"key":"doctoralia_booking","label":"Reserva Doctoralia"}]'::jsonb
WHERE key IN ('first_lead_source', 'last_lead_source')
  AND NOT COALESCE(options, '[]'::jsonb)
    @> '[{"key":"doctoralia_booking"}]'::jsonb;
