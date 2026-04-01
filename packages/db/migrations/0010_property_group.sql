-- Add group column to property_definitions
ALTER TABLE property_definitions ADD COLUMN "group" TEXT;

-- Back-fill groups from the existing hardcoded PROP_GROUPS in the front-end
UPDATE property_definitions SET "group" = 'Atribució'
WHERE key IN (
  'first_lead_source','last_lead_source',
  'first_meta_form','last_meta_form',
  'first_page_url','last_page_url',
  'first_utm_source','last_utm_source',
  'first_utm_campaign','last_utm_campaign',
  'first_utm_medium','last_utm_medium',
  'first_submission_at','last_submission_at'
);

UPDATE property_definitions SET "group" = 'Aircall'
WHERE key IN (
  'last_aircall_call_outcome','last_aircall_call_timestamp',
  'last_aircall_sms_direction','last_aircall_sms_timestamp',
  'last_used_aircall_phone_number','last_used_aircall_tags'
);

UPDATE property_definitions SET "group" = 'Consulta'
WHERE key IN ('consult_reason_code','consult_reason_notes');
