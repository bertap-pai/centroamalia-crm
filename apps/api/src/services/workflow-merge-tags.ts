/**
 * Merge tag resolver: replaces {{contact.first_name}}, {{deal.stage_name}}, etc.
 * Supports pipe filters: | capitalize, | default:X, | date:dd/MM/yyyy
 */

export interface MergeContext {
  contact?: Record<string, unknown>;
  deal?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  user?: Record<string, unknown>;
  centre?: Record<string, unknown>;
}

const TAG_REGEX = /\{\{([^}]+)\}\}/g;

export function resolveMergeTags(template: string, context: MergeContext): string {
  return template.replace(TAG_REGEX, (_match, expression: string) => {
    const parts = expression.trim().split('|').map((s: string) => s.trim());
    const path = parts[0]!;
    const filters = parts.slice(1);

    let value = resolvePath(path, context);
    for (const filter of filters) {
      value = applyFilter(filter, value);
    }
    return value;
  });
}

function resolvePath(path: string, context: MergeContext): string {
  const segments = path.split('.');
  const namespace = segments[0] as keyof MergeContext;
  const obj = context[namespace];

  if (!obj) return '';

  const remaining = segments.slice(1);
  let current: unknown = obj;
  for (const segment of remaining) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[segment];
  }

  if (current == null) return '';
  return String(current);
}

function applyFilter(filter: string, value: string): string {
  const [name, ...args] = filter.split(':');
  const arg = args.join(':');

  switch (name) {
    case 'capitalize':
      return value.charAt(0).toUpperCase() + value.slice(1);

    case 'uppercase':
      return value.toUpperCase();

    case 'lowercase':
      return value.toLowerCase();

    case 'default':
      return value || arg || '';

    case 'date': {
      if (!value) return '';
      try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return value;
        return formatDate(date, arg || 'yyyy-MM-dd');
      } catch {
        return value;
      }
    }

    default:
      return value;
  }
}

function formatDate(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    dd: String(date.getDate()).padStart(2, '0'),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  };

  let result = format;
  for (const [token, replacement] of Object.entries(tokens)) {
    result = result.replace(token, replacement);
  }
  return result;
}
