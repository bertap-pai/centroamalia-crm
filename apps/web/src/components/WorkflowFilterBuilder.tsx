import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';

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

const OPERATOR_DESCRIPTIONS: Record<FilterOperator, string> = {
  equals: 'El valor ha de ser exactament igual al que especifiques',
  not_equals: 'El valor ha de ser diferent del que especifiques',
  is_known: 'El camp ha de tenir qualsevol valor (no buit)',
  is_unknown: "El camp ha d'estar buit o no tenir valor",
  contains: 'El valor ha de contenir el text que especifiques',
  not_contains: 'El valor no ha de contenir el text que especifiques',
  greater_than: 'El valor numèric o de data ha de ser major que el que especifiques',
  less_than: 'El valor numèric o de data ha de ser menor que el que especifiques',
  starts_with: 'El valor ha de començar amb el text que especifiques',
  ends_with: "El valor ha d'acabar amb el text que especifiques",
  in_list: 'El valor ha de coincidir amb algun dels valors de la llista (separats per comes)',
  not_in_list: 'El valor no ha de coincidir amb cap dels valors de la llista',
  changed_in_last_n_days: 'El camp ha canviat en els últims N dies (introdueix el número de dies al valor)',
};

const VALUE_LESS_OPERATORS: FilterOperator[] = ['is_known', 'is_unknown'];

interface PropertyDef {
  key: string;
  label: string;
}

function OperatorSelect({ value, onChange }: { value: FilterOperator; onChange: (v: FilterOperator) => void }) {
  const [open, setOpen] = useState(false);
  const [hoveredOp, setHoveredOp] = useState<FilterOperator | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleMouseEnter(op: FilterOperator) {
    setHoveredOp(op);
    hoverTimer.current = setTimeout(() => setTooltipVisible(true), 2000);
  }

  function handleMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredOp(null);
    setTooltipVisible(false);
  }

  return (
    <div ref={containerRef} style={{ flex: 2, position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, cursor: 'pointer', background: '#fff' }}
      >
        {OPERATOR_LABELS[value]} ▾
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: '#fff', border: '1px solid #ccc', borderRadius: 4, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: 300, overflowY: 'auto' }}>
          {(Object.keys(OPERATOR_LABELS) as FilterOperator[]).map((op) => (
            <div
              key={op}
              onMouseEnter={() => handleMouseEnter(op)}
              onMouseLeave={handleMouseLeave}
              onClick={() => { onChange(op); setOpen(false); }}
              style={{ padding: '8px 12px', cursor: 'pointer', background: op === value ? '#e8f0fe' : 'transparent', position: 'relative' }}
            >
              {OPERATOR_LABELS[op]}
              {tooltipVisible && hoveredOp === op && (
                <div style={{
                  position: 'absolute', left: '105%', top: 0, background: '#333', color: '#fff',
                  padding: '6px 10px', borderRadius: 4, fontSize: 12, whiteSpace: 'normal',
                  maxWidth: 240, zIndex: 200, pointerEvents: 'none',
                }}>
                  {OPERATOR_DESCRIPTIONS[op]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [properties, setProperties] = useState<PropertyDef[] | null>(null);
  const [propertiesError, setPropertiesError] = useState(false);

  useEffect(() => {
    api.get('/api/properties?scope=contact')
      .then((res) => {
        setProperties(res.data as PropertyDef[]);
      })
      .catch(() => {
        setPropertiesError(true);
      });
  }, []);

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
          {properties && !propertiesError ? (
            <select
              value={cond.property}
              onChange={(e) => updateCondition(idx, { ...cond, property: e.target.value })}
              style={{ flex: 2, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
            >
              <option value="">-- Selecciona propietat --</option>
              {properties.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={cond.property}
              onChange={(e) => updateCondition(idx, { ...cond, property: e.target.value })}
              placeholder="propietat (ex: status)"
              style={{ flex: 2, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
            />
          )}
          <OperatorSelect
            value={cond.operator}
            onChange={(op) => updateCondition(idx, { ...cond, operator: op, value: '' })}
          />
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
