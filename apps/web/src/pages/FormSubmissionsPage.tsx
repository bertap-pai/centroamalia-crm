import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

interface Submission {
  id: string;
  data: Record<string, string>;
  createdContactId: string | null;
  sourceUrl: string | null;
  submittedAt: string;
}

interface FormInfo {
  id: string;
  name: string;
  fields: Array<{ key: string; label: string }>;
}

export default function FormSubmissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormInfo | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pageSize = 50;

  useEffect(() => {
    if (!id) return;
    api.get(`/api/forms/${id}`)
      .then((data) => setForm(data))
      .catch(() => setError('Error carregant el formulari.'));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/api/forms/${id}/submissions?page=${page}&pageSize=${pageSize}`)
      .then((data) => {
        setSubmissions(data.data);
        setTotal(data.total);
        setError('');
      })
      .catch(() => setError('Error carregant les respostes.'))
      .finally(() => setLoading(false));
  }, [id, page]);

  function exportCsv() {
    if (!form || submissions.length === 0) return;
    const keys = form.fields.map((f) => f.key);
    const headers = ['Data', ...form.fields.map((f) => f.label), 'Contacte CRM', 'URL origen'];
    const rows = submissions.map((s) => [
      new Date(s.submittedAt).toLocaleString('ca-ES'),
      ...keys.map((k) => s.data[k] ?? ''),
      s.createdContactId ? `Sí (${s.createdContactId.slice(0, 8)})` : 'No',
      s.sourceUrl ?? '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.name}_respostes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = form?.fields ?? [];

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button onClick={() => navigate('/forms')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13 }}>
          ← Formularis
        </button>
        {form && (
          <button onClick={() => navigate(`/forms/${id}/edit`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13 }}>
            ← Editor
          </button>
        )}
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>
          {form ? `Respostes: ${form.name}` : 'Respostes'}
        </h1>
        <span style={{ fontSize: 13, color: '#888' }}>{total} respostes</span>
        {submissions.length > 0 && (
          <button
            onClick={exportCsv}
            style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: '#444' }}
          >
            Exportar CSV
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c0392b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#999', padding: 20 }}>Carregant...</div>
      ) : submissions.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: '40px', textAlign: 'center', color: '#bbb', fontSize: 14 }}>
          Encara no hi ha respostes per aquest formulari.
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={th}>Data</th>
                  {columns.map((col) => (
                    <th key={col.key} style={th}>{col.label}</th>
                  ))}
                  <th style={th}>Contacte CRM</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f3f3' }}>
                    <td style={{ ...td, color: '#888', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {new Date(s.submittedAt).toLocaleString('ca-ES')}
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.data[col.key] ?? '—'}
                      </td>
                    ))}
                    <td style={td}>
                      {s.createdContactId ? (
                        <a
                          href={`/crm/contacts/${s.createdContactId}`}
                          style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: 12 }}
                        >
                          Veure contacte →
                        </a>
                      ) : (
                        <span style={{ color: '#bbb', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > pageSize && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ ...btnStyle, opacity: page === 1 ? 0.4 : 1 }}
              >
                ← Anterior
              </button>
              <span style={{ alignSelf: 'center', fontSize: 13, color: '#666' }}>
                Pàgina {page} de {Math.ceil(total / pageSize)}
              </span>
              <button
                disabled={page >= Math.ceil(total / pageSize)}
                onClick={() => setPage((p) => p + 1)}
                style={{ ...btnStyle, opacity: page >= Math.ceil(total / pageSize) ? 0.4 : 1 }}
              >
                Següent →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 14px',
  verticalAlign: 'middle',
};

const btnStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
  color: '#444',
};
