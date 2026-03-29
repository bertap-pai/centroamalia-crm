import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ApiError } from '../lib/api.js';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface ExistingContact {
  id: string;
  phoneE164: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export default function ContactQuickCreateModal({ onClose, onCreated }: Props) {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [serveiInteres, setServeiInteres] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState<ExistingContact | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { setError('El telèfon és obligatori.'); return; }
    setLoading(true);
    setError('');
    setExisting(null);
    try {
      const properties: Record<string, string> = {};
      if (serveiInteres.trim()) properties['servei_interes'] = serveiInteres.trim();

      await api.post('/api/contacts', {
        phone: phone.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        properties: Object.keys(properties).length > 0 ? properties : undefined,
      });
      onCreated();
    } catch (err: any) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409 && apiErr.data?.error === 'duplicate_phone') {
        setExisting(apiErr.data.existing as ExistingContact);
      } else if (apiErr.status === 400 && apiErr.data?.error === 'invalid_phone') {
        setError('El telèfon no és vàlid. Introdueix un número vàlid (+34 per defecte).');
      } else {
        setError('Error inesperat. Torna-ho a intentar.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#fff', borderRadius: 10, padding: '28px 28px 24px',
          width: 420, zIndex: 101, boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Nou contacte</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
        </div>

        {existing ? (
          <DupPanel existing={existing} onNavigate={() => navigate(`/contacts/${existing.id}`)} onClose={onClose} />
        ) : (
          <form onSubmit={handleSubmit}>
            <Field label="Telèfon *" hint="+34 per defecte">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="600 000 000"
                autoFocus
                style={inputStyle}
              />
            </Field>
            <Field label="Nom">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Joan"
                style={inputStyle}
              />
            </Field>
            <Field label="Cognoms">
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="García"
                style={inputStyle}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="joan@example.com"
                style={inputStyle}
              />
            </Field>
            <Field label="Servei interès">
              <input
                type="text"
                value={serveiInteres}
                onChange={(e) => setServeiInteres(e.target.value)}
                placeholder="Fisioteràpia, pilates..."
                style={inputStyle}
              />
            </Field>

            {error && (
              <p style={{ color: 'var(--color-error)', fontSize: 13, margin: '8px 0' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={onClose} style={secondaryBtn}>
                Cancel·lar
              </button>
              <button type="submit" disabled={loading} style={primaryBtn}>
                {loading ? 'Guardant...' : 'Crear contacte'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function DupPanel({ existing, onNavigate, onClose }: { existing: ExistingContact; onNavigate: () => void; onClose: () => void }) {
  const name = [existing.firstName, existing.lastName].filter(Boolean).join(' ') || 'Sense nom';
  return (
    <div>
      <p style={{ fontSize: 13, color: '#555', marginTop: 0 }}>
        El telèfon <strong>{existing.phoneE164}</strong> ja existeix al sistema.
      </p>
      <div
        style={{
          background: '#fef3ed', border: '1px solid #f0b99e', borderRadius: 6,
          padding: '12px 14px', marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
        <div style={{ fontSize: 12, color: '#666' }}>{existing.phoneE164}</div>
        {existing.email && <div style={{ fontSize: 12, color: '#666' }}>{existing.email}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={secondaryBtn}>Tancar</button>
        <button onClick={onNavigate} style={primaryBtn}>Veure contacte</button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
        {label} {hint && <span style={{ fontWeight: 400, color: '#999' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
