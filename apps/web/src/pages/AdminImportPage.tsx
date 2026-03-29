import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportRow {
  rowIndex: number;
  sheet: string;
  errors: string[];
  warnings: string[];
  action?: 'create' | 'update' | 'skip';
}

interface SheetStats {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ImportReport {
  dryRun: boolean;
  contacts: SheetStats;
  deals: SheetStats;
  dealContacts: SheetStats & { linked: number };
  rows: ImportRow[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [csvSheet, setCsvSheet] = useState<'contacts' | 'deals' | 'deal_contacts'>('contacts');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isCsv = file?.name.toLowerCase().endsWith('.csv');

  async function runImport() {
    if (!file || loading) return;
    setLoading(true);
    setError('');
    setReport(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dryRun', dryRun ? 'true' : 'false');
      if (isCsv) fd.append('sheet', csvSheet);

      const res = await fetch('/api/import', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Error en importar. Torna-ho a intentar.');
        return;
      }
      setReport(data as ImportReport);
    } catch (e: any) {
      setError(e.message ?? 'Error de xarxa.');
    } finally {
      setLoading(false);
    }
  }

  const errorRows = report?.rows.filter((r) => r.errors.length > 0) ?? [];
  const warnRows = report?.rows.filter((r) => r.warnings.length > 0 && r.errors.length === 0) ?? [];
  const okRows = report?.rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0) ?? [];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 24px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
        <Link to="/admin/properties" style={{ color: '#999', textDecoration: 'none' }}>
          Admin
        </Link>{' '}
        / Importació
      </div>

      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Importació de dades</h2>
      <p style={{ margin: '0 0 24px', color: '#666', fontSize: 13 }}>
        Importa contactes i deals des d'un fitxer Excel (.xlsx) o CSV. Primer fes una importació
        en mode assaig (dry-run) per revisar errors.
      </p>

      {/* Form card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File picker */}
          <div>
            <label style={labelStyle}>Fitxer (.xlsx, .xls o .csv)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button style={outlineBtn} onClick={() => fileRef.current?.click()}>
                Seleccionar fitxer
              </button>
              {file && (
                <span style={{ fontSize: 13, color: '#444' }}>
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>
          </div>

          {/* CSV sheet selector */}
          {isCsv && (
            <div>
              <label style={labelStyle}>Full (per a CSV)</label>
              <select
                value={csvSheet}
                onChange={(e) => setCsvSheet(e.target.value as any)}
                style={{ ...inputStyle, width: 200 }}
              >
                <option value="contacts">contacts</option>
                <option value="deals">deals</option>
                <option value="deal_contacts">deal_contacts</option>
              </select>
            </div>
          )}

          {/* Dry-run toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="dryRun"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="dryRun" style={{ fontSize: 13, cursor: 'pointer' }}>
              <strong>Mode assaig</strong> — valida sense escriure a la base de dades
            </label>
          </div>

          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 13, padding: '8px 12px', background: '#fff0f0', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div>
            <button
              onClick={runImport}
              disabled={!file || loading}
              style={{ ...primaryBtn, minWidth: 140 }}
            >
              {loading ? 'Processant...' : dryRun ? 'Executar assaig' : 'Importar dades'}
            </button>
            {!dryRun && (
              <span style={{ marginLeft: 12, fontSize: 12, color: '#e74c3c', fontWeight: 600 }}>
                ⚠ Escriurà a la base de dades
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Column reference */}
      <div style={{ ...cardStyle, marginTop: 20 }}>
        <h3 style={sectionTitle}>Referència de columnes</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[
            {
              name: 'contacts',
              cols: ['phone *', 'first_name', 'last_name', 'email', '+ claus de propietats'],
            },
            {
              name: 'deals',
              cols: ['external_id *', 'pipeline_slug *', 'stage_slug *', 'owner_email', '+ claus de propietats'],
            },
            {
              name: 'deal_contacts',
              cols: ['deal_external_id *', 'phone *', 'is_primary (true/1)', 'role'],
            },
          ].map((s) => (
            <div key={s.name}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {s.name}
              </div>
              {s.cols.map((c) => (
                <div key={c} style={{ fontSize: 12, color: c.endsWith('*') ? '#333' : '#777', marginBottom: 2 }}>
                  {c.endsWith('*') ? <strong>{c}</strong> : c}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 10 }}>* Requerit</div>
      </div>

      {/* Report */}
      {report && (
        <div style={{ marginTop: 20 }}>
          {/* Summary */}
          <div style={{ ...cardStyle, background: report.dryRun ? '#fffbf0' : '#f0fff4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>
                {report.dryRun ? '🔍 Resultat de l\'assaig' : '✅ Importació completada'}
              </h3>
              {report.dryRun && (
                <span style={{ fontSize: 12, color: '#856404', background: '#fff3cd', padding: '2px 8px', borderRadius: 4 }}>
                  DRY RUN — res escrit
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Contactes', s: report.contacts },
                { label: 'Deals', s: report.deals },
                { label: 'Contacte-Deal', s: { ...report.dealContacts, created: report.dealContacts.linked } },
              ].map(({ label, s }) => (
                <div key={label} style={{ padding: '12px 16px', background: '#fff', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>{label}</div>
                  <StatRow label="Total" value={s.total} />
                  <StatRow label="Nous" value={s.created} color="#27ae60" />
                  <StatRow label="Actualitzats" value={s.updated ?? 0} color="#2980b9" />
                  {s.errors > 0 && <StatRow label="Errors" value={s.errors} color="#e74c3c" />}
                </div>
              ))}
            </div>
          </div>

          {/* Error rows */}
          {errorRows.length > 0 && (
            <div style={{ ...cardStyle, marginTop: 16, borderColor: '#fcc' }}>
              <h3 style={{ ...sectionTitle, color: '#c0392b' }}>Errors ({errorRows.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                {errorRows.map((r) => (
                  <div key={`${r.sheet}-${r.rowIndex}`} style={{ fontSize: 12, padding: '6px 10px', background: '#fff5f5', borderRadius: 5, borderLeft: '3px solid #e74c3c' }}>
                    <span style={{ fontWeight: 700 }}>[{r.sheet} fila {r.rowIndex}]</span>{' '}
                    {r.errors.join(' · ')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning rows */}
          {warnRows.length > 0 && (
            <div style={{ ...cardStyle, marginTop: 16 }}>
              <h3 style={{ ...sectionTitle, color: '#856404' }}>Avisos ({warnRows.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                {warnRows.map((r) => (
                  <div key={`${r.sheet}-${r.rowIndex}`} style={{ fontSize: 12, padding: '6px 10px', background: '#fffbf0', borderRadius: 5, borderLeft: '3px solid #ffc107' }}>
                    <span style={{ fontWeight: 700 }}>[{r.sheet} fila {r.rowIndex}]</span>{' '}
                    {r.warnings.join(' · ')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? '#333' }}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '20px 24px',
  border: '1px solid var(--color-border)',
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 14,
  fontWeight: 700,
  color: '#555',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  padding: '8px 18px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  background: '#fff',
  color: '#555',
  border: '1px solid var(--color-border)',
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
