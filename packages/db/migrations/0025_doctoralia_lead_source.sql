UPDATE property_definitions AS pd
SET options = COALESCE(pd.options, '[]'::jsonb) || (
  SELECT COALESCE(jsonb_agg(candidate.option), '[]'::jsonb)
  FROM jsonb_array_elements(
    '[{"key":"google","label":"Google"},{"key":"instagram","label":"Instagram"},{"key":"facebook","label":"Facebook"},{"key":"organic","label":"Orgànic"},{"key":"direct","label":"Directe"},{"key":"doctoralia","label":"Doctoralia"}]'::jsonb
  ) AS candidate(option)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(pd.options, '[]'::jsonb)) AS existing(option)
    WHERE existing.option->>'key' = candidate.option->>'key'
  )
)
WHERE pd.key IN ('first_lead_source', 'last_lead_source');
