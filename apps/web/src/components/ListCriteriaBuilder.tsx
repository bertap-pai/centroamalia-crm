import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: string;
  scope: string;
  options: Array<{ key: string; label: string }> | null;
}

interface Pipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

interface UserOption {
  id: string;
  name: string | null;
}

export interface ListCriteriaBuilderProps {
  objectType: 'contact' | 'deal';
  criteria: Record<string, string>;
  onChange: (criteria: Record<string, string>) => void;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#555',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

export default function ListCriteriaBuilder({ objectType, criteria, onChange }: ListCriteriaBuilderProps) {
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    api.get(`/api/properties?scope=${objectType}`).then((defs: PropertyDef[]) => {
      const filtered = defs.filter((d) => d.scope === objectType || d.scope === 'both');
      setPropertyDefs(filtered);
    }).catch(() => {});

    if (objectType === 'deal') {
      api.get('/api/pipelines').then(setPipelines).catch(() => {});
      api.get('/api/users').then(setUsers).catch(() => {});
    }
  }, [objectType]);

  function update(key: string, value: string) {
    const next = { ...criteria };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange(next);
  }

  const filterablePropDefs = propertyDefs.filter(
    (d) => !['first_name', 'last_name', 'email', 'phone_e164'].includes(d.key),
  );

  // For deal stage filter, find stages from the selected pipeline (or first pipeline)
  const firstPipeline = pipelines[0];
  const selectedPipelineId = criteria['pipelineId'] || (firstPipeline ? firstPipeline.id : '');
  const currentPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  return (
    <div
      style={{
        padding: '16px 20px', background: '#f9f9fb',
        border: '1px solid var(--color-border)', borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 2 }}>
        Criteris de filtre
      </div>

      {/* Date range */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Data creació</span>
        <input
          type="date"
          value={criteria['createdFrom'] ?? ''}
          onChange={(e) => update('createdFrom', e.target.value)}
          style={{ ...inputStyle, fontSize: 13, padding: '6px 8px' }}
        />
        <span style={{ fontSize: 12, color: '#888' }}>fins</span>
        <input
          type="date"
          value={criteria['createdTo'] ?? ''}
          onChange={(e) => update('createdTo', e.target.value)}
          style={{ ...inputStyle, fontSize: 13, padding: '6px 8px' }}
        />
      </div>

      {/* Deal-specific: pipeline, stage, owner */}
      {objectType === 'deal' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 16px', alignItems: 'end' }}>
          {pipelines.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Pipeline</label>
              <select
                value={criteria['pipelineId'] ?? ''}
                onChange={(e) => {
                  update('pipelineId', e.target.value);
                  // Clear stage when pipeline changes
                  if (criteria['stageId']) update('stageId', '');
                }}
                style={{ ...inputStyle, width: '100%' }}
              >
                <option value="">Tots els pipelines</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {currentPipeline && currentPipeline.stages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Etapa</label>
              <select
                value={criteria['stageId'] ?? ''}
                onChange={(e) => update('stageId', e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              >
                <option value="">Totes les etapes</option>
                {currentPipeline.stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {users.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Responsable</label>
              <select
                value={criteria['ownerUserId'] ?? ''}
                onChange={(e) => update('ownerUserId', e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              >
                <option value="">Tots els responsables</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Property filters */}
      {filterablePropDefs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 16px', alignItems: 'end' }}>
          {filterablePropDefs.map((def) => (
            <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>{def.label}</label>
              {def.type === 'select' || def.type === 'multiselect' ? (
                <select
                  value={criteria[`filter[${def.key}]`] ?? ''}
                  onChange={(e) => update(`filter[${def.key}]`, e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  <option value="">Tots</option>
                  {def.options?.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              ) : def.type === 'date' || def.type === 'datetime' ? (
                <input
                  type="date"
                  value={criteria[`filter[${def.key}]`] ?? ''}
                  onChange={(e) => update(`filter[${def.key}]`, e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              ) : (
                <input
                  type="text"
                  value={criteria[`filter[${def.key}]`] ?? ''}
                  placeholder={`Filtra per ${def.label.toLowerCase()}...`}
                  onChange={(e) => update(`filter[${def.key}]`, e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
