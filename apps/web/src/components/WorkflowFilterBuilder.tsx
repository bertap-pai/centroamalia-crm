import { useState } from 'react';

export type FilterOperator =
  | 'equals' | 'not_equals' | 'is_known' | 'is_unknown'
  | 'contains' | 'not_contains' | 'greater_than' | 'less_than'
  | 'starts_with' | 'ends_with' | 'in_list' | 'not_in_list'
  | 'changed_in_last_n_days';

export interface FilterCondition {
  property: string;
  operator: FilterOperator;
  value?: string | string[];
}

export interface FilterGroup {
  logic: 'and' | 'or';
  conditions: (FilterCondition | FilterGroup)[];
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'és igual a',
  not_equals: 'no és igual a',
  is_known: 'és conegut',
  is_unknown: 'és desconegut',
  contains: 'conté',
  not_contains: 'no conté',
  greater_than: 'és major que',
  less_than: 'és menor que',
  starts_with: 'comença amb',
  ends_with: 'acaba amb',
  in_list: 'és a la llista',
  not_in_list: 'no és a la llista',
  changed_in_last_n_days: 'ha canviat en els últims N dies',
};

const VALUE_LESS_OPERATORS: FilterOperator[] = ['is_known', 'is_unknown'];

interface Props {
  value: FilterGroup | null;
  onChange: (value: FilterGroup | null) => void;
}

function emptyGroup(): FilterGroup {
  return { logic: 'and', conditions: [] };
}

function emptyCondition(): FilterCondition {
  return { property: '', operator: 'equals', value: '' };
}

export default function WorkflowFilterBuilder({ value, onChange }: Props) {
  const group = value ?? emptyGroup();

  function updateLogic(logic: 'and' | 'or') {
    onChange({ ...group, logic });
  }

  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, emptyCondition()] });
  }

  function removeCondition(idx: number) {
    const next = group.conditions.filter((_, i) => i !== idx);
    onChange(next.length === 0 ? null : { ...group, conditions: next });
  }

  function updateCondition(idx: number, updated: FilterCondition) {
    const next = group.conditions.map((c, i) => (i === idx ? updated : c));
    onChange({ ...group, conditions: next });
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#555' }}>Lògica:</span>
        {(['and', 'or'] as const).map((l) => (
          <button
            key={l}
            onClick={() => updateLogic(l)}
            style={{
              padding: '2px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer',
              background: group.logic === l ? '#1a73e8' : '#fff',
              color: group.logic === l ? '#fff' : '#333',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {(group.conditions as FilterCondition[]).map((cond, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input
            value={cond.property}
            onChange={(e) => updateCondition(idx, { ...cond, property: e.target.value })}
            placeholder="propietat (ex: status)"
            style={{ flex: 2, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
          />
          <select
            value={cond.operator}
            onChange={(e) => updateCondition(idx, { ...cond, operator: e.target.value as FilterOperator, value: '' })}
            style={{ flex: 2, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
          >
            {(Object.keys(OPERATOR_LABELS) as FilterOperator[]).map((op) => (
              <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
            ))}
          </select>
          {!VALUE_LESS_OPERATORS.includes(cond.operator) && (
            <input
              value={typeof cond.value === 'string' ? cond.value : ''}
              onChange={(e) => updateCondition(idx, { ...cond, value: e.target.value })}
              placeholder="valor"
              style={{ flex: 2, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
            />
          )}
          <button
            onClick={() => removeCondition(idx)}
            style={{ padding: '4px 8px', border: 'none', background: 'none', color: '#c62828', cursor: 'pointer', fontSize: 16 }}
          >×</button>
        </div>
      ))}

      <button
        onClick={addCondition}
        style={{ padding: '6px 12px', border: '1px dashed #aaa', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555' }}
      >
        + Afegir condició
      </button>
    </div>
  );
}
