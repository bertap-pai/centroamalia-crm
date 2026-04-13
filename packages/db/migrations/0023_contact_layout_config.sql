CREATE TABLE contact_layout_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order JSONB NOT NULL DEFAULT '[]',
  pinned_property_keys JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
