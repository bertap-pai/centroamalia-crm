import { useState, useEffect } from 'react';

interface PropertyDef {
  id: string;
  key: string;
  label: string;
  scope: 'contact' | 'deal' | 'both';
  type: string;
  options?: Array<{ key: string; label: string }>;
}

interface FilterRow {
  key: string;
  value: string;
}

export default function AdminExportPage() {
  const [type, setType] = useState<'contacts' | 'deals' | 'both'>('both');
  const [anonymous, setAnonymous] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/properties?scope=all', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: PropertyDef[]) => setPropDefs(data))
      .catch(() => {});
  }, []);

  const relevantProps = propDefs.filter((pd) => {
    if (type === 'contacts') return pd.scope === 'contact' || pd.scope === 'both';
    if (type === 'deals') return pd.scope === 'deal' || pd.scope === 'both';
    return true;
  });

  function addFilter() {
    setFilters((prev) => [...prev, { key: '', value: '' }]);
  }

  function updateFilter(idx: number, field: 'key' | 'value', val: string) {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, [field]: val } : f)));
  }

  function removeFilter(idx: number) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  async function doExport() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('type', type);
      params.set('anonymous', String(anonymous));
      params.set('format', format);
      if (includeArchived) params.set('includeArchived', 'true');
      for (const f of filters) {
        if (f.key && f.value) params.set(`filter[${f.key}]`, f.value);
      }

      const res = await fetch(`/api/export?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'Error desconegut');
    } finally {
      setLoading(false);
    }
  }

  const isCsvDisabled = type === 'both';

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Exportació</h1>

      {/* What to export */}
      <Section title="Que exportar">
        <RadioGroup
          value={type}
          options={[
            { value: 'contacts', label: 'Contactes' },
            { value: 'deals', label: 'Deals' },
            { value: 'both', label: 'Tots dos (contactes + deals)' },
          ]}
          onChange={(v) => {
            setType(v as typeof type);
            if (v === 'both' && format === 'csv') setFormat('xlsx');
          }}
        />
      </Section>

      {/* Format */}
      <Section title="Format">
        <RadioGroup
          value={format}
          options={[
            { value: 'xlsx', label: 'Excel (.xlsx)' },
            { value: 'csv', label: 'CSV (.csv)', disabled: isCsvDisabled },
          ]}
          onChange={(v) => setFormat(v as typeof format)}
        />
        {isCsvDisabled && (
          <p style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
            El format CSV no esta disponible quan s&apos;exporten tots dos a la vegada.
          </p>
        )}
      </Section>

      {/* Options */}
      <Section title="Opcions">
        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <span>
            <strong>Anonim</strong> — exporta sense nom, telèfon ni email
          </span>
        </label>
        <label style={{ ...checkboxLabel, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <span>Inclou registres arxivats</span>
        </label>
      </Section>

      {/* Property filters */}
      <Section title="Filtres per propietat (opcional)">
        {filters.length === 0 && (
          <p style={{ fontSize: 13, color: '#888', marginBottom: 10 }}>
            Sense filtres s&apos;exportaran tots els registres.
          </p>
        )}
        {filters.map((f, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select
              value={f.key}
              onChange={(e) => updateFilter(idx, 'key', e.target.value)}
              style={selectStyle}
            >
              <option value="">— selecciona propietat —</option>
              {relevantProps.map((pd) => (
                <option key={pd.id} value={pd.key}>
                  {pd.label}
                </option>
              ))}
            </select>
            {f.key && (() => {
              const pd = propDefs.find((p) => p.key === f.key);
              if (pd?.options && pd.options.length > 0) {
                return (
                  <select
                    value={f.value}
                    onChange={(e) => updateFilter(idx, 'value', e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— selecciona valor —</option>
                    {pd.options.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                );
              }
              return (
                <input
                  type="text"
                  placeholder="valor"
                  value={f.value}
                  onChange={(e) => updateFilter(idx, 'value', e.target.value)}
                  style={inputStyle}
                />
              );
            })()}
            <button
              onClick={() => removeFilter(idx)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}
              title="Elimina filtre"
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={addFilter} style={secondaryBtn}>
          + Afegir filtre
        </button>
      </Section>

      {/* Error */}
      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Download */}
      <button onClick={doExport} disabled={loading} style={primaryBtn}>
        {loading ? 'Generant...' : 'Descarregar exportació'}
      </button>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RadioGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((o) => (
        <label
          key={o.value}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: o.disabled ? 'not-allowed' : 'pointer',
            opacity: o.disabled ? 0.5 : 1,
            fontSize: 13,
          }}
        >
          <input
            type="radio"
            name="radio"
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => !o.disabled && onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0,
  cursor: 'pointer',
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border, #333)',
  background: 'var(--color-surface, #1e1e1e)',
  color: 'var(--color-text, #eee)',
  fontSize: 13,
  flex: 1,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border, #333)',
  background: 'var(--color-surface, #1e1e1e)',
  color: 'var(--color-text, #eee)',
  fontSize: 13,
  flex: 1,
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--color-border, #444)',
  background: 'transparent',
  color: 'var(--color-text, #ccc)',
  fontSize: 13,
  cursor: 'pointer',
  marginTop: 4,
};

const primaryBtn: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--color-primary, #e87d52)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
