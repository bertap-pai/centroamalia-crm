import type { FilterGroup, FilterCondition, FilterOperator } from '@crm/db';

/**
 * Evaluates a filter group against a record (typically a contact with properties).
 * Pure function — no side effects, no DB access.
 */
export function evaluateFilters(
  filters: FilterGroup | null | undefined,
  record: Record<string, unknown>,
): boolean {
  if (!filters) return true;
  return evaluateGroup(filters, record);
}

function evaluateGroup(group: FilterGroup, record: Record<string, unknown>): boolean {
  if (!group.conditions || group.conditions.length === 0) return true;

  if (group.logic === 'and') {
    return group.conditions.every((c) => evaluateNode(c, record));
  }
  return group.conditions.some((c) => evaluateNode(c, record));
}

function evaluateNode(
  node: FilterCondition | FilterGroup,
  record: Record<string, unknown>,
): boolean {
  if ('logic' in node) {
    return evaluateGroup(node, record);
  }
  return evaluateCondition(node, record);
}

function evaluateCondition(condition: FilterCondition, record: Record<string, unknown>): boolean {
  const fieldValue = resolveProperty(record, condition.property);
  return applyOperator(condition.operator, fieldValue, condition.value);
}

function resolveProperty(record: Record<string, unknown>, property: string): unknown {
  // Support dot-notation: "contact.first_name" or just "first_name"
  const parts = property.split('.');
  let current: unknown = record;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function applyOperator(
  operator: FilterOperator,
  fieldValue: unknown,
  conditionValue?: string | string[],
): boolean {
  switch (operator) {
    case 'equals':
      return String(fieldValue ?? '') === String(conditionValue ?? '');

    case 'not_equals':
      return String(fieldValue ?? '') !== String(conditionValue ?? '');

    case 'is_known':
      return fieldValue != null && fieldValue !== '';

    case 'is_unknown':
      return fieldValue == null || fieldValue === '';

    case 'in_list': {
      const list = Array.isArray(conditionValue) ? conditionValue : [];
      return list.includes(String(fieldValue ?? ''));
    }

    case 'not_in_list': {
      const list = Array.isArray(conditionValue) ? conditionValue : [];
      return !list.includes(String(fieldValue ?? ''));
    }

    default:
      return false;
  }
}
