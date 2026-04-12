export interface MetaFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadData {
  id: string;
  created_time: string;
  field_data: MetaFieldData[];
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
}

export interface MappedLeadFields {
  phoneE164: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  extraFields: Record<string, string>;
}

// Meta field name → CRM field
const FIELD_MAP: Record<string, keyof Omit<MappedLeadFields, 'extraFields'>> = {
  phone_number: 'phoneE164',
  phone: 'phoneE164',
  email: 'email',
  first_name: 'firstName',
  last_name: 'lastName',
  full_name: 'firstName', // handled specially below
};

export async function fetchLeadData(
  leadgenId: string,
  accessToken: string,
): Promise<MetaLeadData> {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(leadgenId)}?fields=field_data,created_time,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta Graph API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<MetaLeadData>;
}

export function mapLeadFields(fieldData: MetaFieldData[]): MappedLeadFields {
  const result: MappedLeadFields = {
    phoneE164: null,
    email: null,
    firstName: null,
    lastName: null,
    extraFields: {},
  };

  for (const field of fieldData) {
    const value = field.values[0] ?? '';
    const normalized = field.name.toLowerCase().replace(/\s+/g, '_');

    if (normalized === 'full_name') {
      const parts = value.trim().split(/\s+/);
      result.firstName = parts[0] ?? null;
      result.lastName = parts.slice(1).join(' ') || null;
      continue;
    }

    const crmField = FIELD_MAP[normalized];
    if (crmField && crmField !== 'firstName') {
      (result as any)[crmField] = value || null;
    } else if (crmField === 'firstName') {
      result.firstName = value || null;
    } else {
      result.extraFields[field.name] = value;
    }
  }

  return result;
}
