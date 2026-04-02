import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BASE_PATH } from '../lib/base-path.js';

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';

function getOption(options: Array<{ key: string; label: string }>, key: string, fallback: string): string {
  return options.find((o) => o.key === key)?.label ?? fallback;
}

interface FormField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  placeholder: string | null;
  isRequired: boolean;
  options: Array<{ key: string; label: string }>;
}

interface FormData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  submitLabel: string;
  successMessage: string;
  fields: FormField[];
}

async function apiGet(path: string) {
  const res = await fetch(BASE_PATH + path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(BASE_PATH + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error ?? 'error'), { data });
  }
  return res.json();
}

export default function FormEmbedPage() {
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');

  useEffect(() => {
    if (!id) return;
    apiGet(`/api/forms/${id}/embed`)
      .then((data) => {
        setForm(data);
        const initial: Record<string, string> = {};
        for (const f of data.fields ?? []) initial[f.key] = '';
        setValues(initial);
      })
      .catch(() => setGlobalError('Formulari no disponible.'))
      .finally(() => setLoading(false));
  }, [id]);

  function validate(): boolean {
    if (!form) return false;
    const errs: Record<string, string> = {};
    for (const field of form.fields) {
      if (field.isRequired && !values[field.key]?.trim()) {
        errs[field.key] = 'Aquest camp és obligatori.';
      }
      if (field.type === 'email' && values[field.key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[field.key]!)) {
        errs[field.key] = 'Introdueix un email vàlid.';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!validate()) return;
    setSubmitting(true);
    setGlobalError('');
    try {
      await apiPost(`/api/forms/${form.id}/submit`, { ...values, _hp: '' });
      setSubmitted(true);
    } catch (err: any) {
      if (err?.data?.error === 'too_many_requests') {
        setGlobalError('Massa sol·licituds. Espera un moment i torna-ho a provar.');
      } else {
        setGlobalError('S\'ha produït un error. Torna-ho a provar.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#999', fontSize: 14 }}>Carregant...</div>
      </div>
    );
  }

  if (globalError && !form) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#c0392b', fontSize: 14 }}>{globalError}</div>
      </div>
    );
  }

  if (!form) return null;

  if (submitted) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#2e7d32', marginBottom: 8 }}>
            Enviat correctament!
          </div>
          <div style={{ fontSize: 14, color: '#555' }}>{form.successMessage}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <form onSubmit={handleSubmit} noValidate>
        {form.description && (
          <p style={{ margin: '0 0 24px', color: '#666', fontSize: 14 }}>{form.description}</p>
        )}

        {globalError && (
          <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c0392b', fontSize: 13 }}>
            {globalError}
          </div>
        )}

        {/* Honeypot */}
        <input name="_hp" type="text" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" readOnly value="" />

        {form.fields.map((field) => (
          <div key={field.key} style={{ marginBottom: 18 }}>
            {field.type !== 'static_text' && (
              <label style={{ display: 'block', fontWeight: 500, fontSize: 13, color: '#333', marginBottom: 5 }}>
                {field.label}
                {field.isRequired && <span style={{ color: '#e87d52', marginLeft: 3 }}>*</span>}
              </label>
            )}

            {field.type === 'static_text' ? (() => {
              const preset = getOption(field.options, 'preset', 'normal');
              const color = getOption(field.options, 'color', '#333');
              if (preset === 'heading') {
                return (
                  <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color }}>{field.label}</h2>
                );
              }
              if (preset === 'caption') {
                return (
                  <p style={{ margin: '0 0 4px', fontSize: 12, color, opacity: 0.75 }}>{field.label}</p>
                );
              }
              return (
                <p style={{ margin: '0 0 4px', fontSize: 14, color }}>{field.label}</p>
              );
            })() : field.type === 'textarea' ? (
              <textarea
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                placeholder={field.placeholder ?? ''}
                rows={4}
                style={{ ...fieldStyle, resize: 'vertical', borderColor: errors[field.key] ? '#e74c3c' : undefined }}
              />
            ) : field.type === 'select' ? (
              <select
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                style={{ ...fieldStyle, borderColor: errors[field.key] ? '#e74c3c' : undefined }}
              >
                <option value="">— Selecciona —</option>
                {field.options.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={values[field.key] === 'true'}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.checked ? 'true' : '' })}
                  style={{ marginTop: 2, width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13, color: '#555' }}>{field.placeholder || field.label}</span>
              </label>
            ) : (
              <input
                type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                placeholder={field.placeholder ?? ''}
                style={{ ...fieldStyle, borderColor: errors[field.key] ? '#e74c3c' : undefined }}
              />
            )}

            {errors[field.key] && (
              <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 4 }}>{errors[field.key]}</div>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 8,
            background: '#e87d52',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '11px 24px',
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            width: '100%',
          }}
        >
          {submitting ? 'Enviant...' : form.submitLabel}
        </button>
      </form>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  maxWidth: 540,
  margin: '0 auto',
  padding: '32px 20px',
  background: '#fff',
  minHeight: '100vh',
  boxSizing: 'border-box',
};

const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 14,
  background: '#fff',
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s',
};
