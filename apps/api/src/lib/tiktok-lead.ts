export interface TikTokField {
  name: string;
  value: string;
}

export interface TikTokLeadResponse {
  code: number;
  message: string;
  data: {
    lead_id: string;
    create_time: number;
    custom_questions: TikTokField[];
  };
}

export interface MappedLeadFields {
  phoneE164: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  extraFields: Record<string, string>;
}

// TikTok field name → CRM field
const FIELD_MAP: Record<string, keyof Omit<MappedLeadFields, 'extraFields'>> = {
  phone_number: 'phoneE164',
  phone: 'phoneE164',
  email: 'email',
  first_name: 'firstName',
  last_name: 'lastName',
  full_name: 'firstName', // handled specially below
  name: 'firstName', // handled specially below
};

export async function fetchTikTokLeadData(
  advertiserId: string,
  leadId: string,
  accessToken: string,
): Promise<TikTokLeadResponse['data']> {
  const url = `https://business-api.tiktok.com/open_api/v1.3/lead/get/?advertiser_id=${encodeURIComponent(advertiserId)}&lead_id=${encodeURIComponent(leadId)}`;
  const res = await fetch(url, {
    headers: { 'Access-Token': accessToken },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikTok Lead API error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as TikTokLeadResponse;
  if (json.code !== 0) {
    throw new Error(`TikTok Lead API error code ${json.code}: ${json.message}`);
  }
  return json.data;
}

export function mapTikTokFields(fields: TikTokField[]): MappedLeadFields {
  const result: MappedLeadFields = {
    phoneE164: null,
    email: null,
    firstName: null,
    lastName: null,
    extraFields: {},
  };

  for (const field of fields) {
    const value = field.value ?? '';
    const normalized = field.name.toLowerCase().replace(/\s+/g, '_');

    if (normalized === 'full_name' || normalized === 'name') {
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
