import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api.js';

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

interface Stage {
  id: string;
  name: string;
  position: number;
}

interface ContactResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
}

interface Props {
  onClose: () => void;
  onCreated: (dealId: string) => void;
}

export default function DealCreateModal({ onClose, onCreated }: Props) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string | null; email: string }[]>([]);

  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');

  // Contact search
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<ContactResult[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);
  const [searchingContacts, setSearchingContacts] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/api/pipelines'),
      api.get('/api/users'),
    ]).then(([ps, us]) => {
      setPipelines(ps);
      setUsers(us);
      if (ps.length > 0) {
        setPipelineId(ps[0].id);
        if (ps[0].stages.length > 0) setStageId(ps[0].stages[0].id);
      }
    }).catch(() => {});
  }, []);

  // Search contacts
  useEffect(() => {
    if (!contactSearch.trim() || contactSearch.length < 2) {
      setContactResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingContacts(true);
      try {
        const res = await api.get(`/api/contacts?q=${encodeURIComponent(contactSearch)}&pageSize=8`);
        setContactResults(res.data ?? []);
      } catch {
        setContactResults([]);
      } finally {
        setSearchingContacts(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [contactSearch]);

  const currentPipeline = pipelines.find((p) => p.id === pipelineId);
  const availableStages = currentPipeline?.stages ?? [];

  function handlePipelineChange(id: string) {
    setPipelineId(id);
    const p = pipelines.find((p) => p.id === id);
    setStageId(p?.stages[0]?.id ?? '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pipelineId) { setError('Cal seleccionar un pipeline.'); return; }
    if (!stageId) { setError('Cal seleccionar una etapa.'); return; }
    if (!selectedContact) { setError('Cal seleccionar un contacte principal.'); return; }

    setLoading(true);
    setError('');
    try {
      const deal = await api.post('/api/deals', {
        pipelineId,
        stageId,
        ownerUserId: ownerUserId || undefined,
        primaryContactId: selectedContact.id,
      });
      onCreated(deal.id);
    } catch (err: any) {
      const apiErr = err as ApiError;
      setError(apiErr.data?.error ?? 'Error inesperat. Torna-ho a intentar.');
    } finally {
      setLoading(false);
    }
  }

  const contactDisplayName = (c: ContactResult) =>
    [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phoneE164 || c.email || 'Sense nom';

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100 }}
      />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#fff', borderRadius: 10, padding: '28px 28px 24px',
          width: 460, zIndex: 101, boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Nou deal</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Pipeline */}
          <Field label="Pipeline *">
            <select
              value={pipelineId}
              onChange={(e) => handlePipelineChange(e.target.value)}
              style={selectStyle}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          {/* Stage */}
          <Field label="Etapa *">
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              style={selectStyle}
            >
              {availableStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>

          {/* Owner */}
          <Field label="Responsable">
            <select
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— Sense responsable —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
              ))}
            </select>
          </Field>

          {/* Primary contact */}
          <Field label="Contacte principal *">
            {selectedContact ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    flex: 1, padding: '7px 10px', border: '1px solid var(--color-border)',
                    borderRadius: 6, fontSize: 13, background: '#f9f9f9',
                  }}
                >
                  {contactDisplayName(selectedContact)}
                  {selectedContact.phoneE164 && (
                    <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>{selectedContact.phoneE164}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedContact(null); setContactSearch(''); }}
                  style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', cursor: 'pointer', color: '#888', fontSize: 12 }}
                >
                  Canviar
                </button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Cerca per nom, telèfon..."
                  style={inputStyle}
                  autoComplete="off"
                />
                {(contactResults.length > 0 || searchingContacts) && (
                  <div
                    style={{
                      position: 'absolute', top: '100%', left: 0, right: 0,
                      background: '#fff', border: '1px solid var(--color-border)',
                      borderRadius: 6, zIndex: 10, boxShadow: 'var(--shadow-sm)',
                      maxHeight: 200, overflowY: 'auto',
                    }}
                  >
                    {searchingContacts ? (
                      <div style={{ padding: '8px 12px', color: '#999', fontSize: 13 }}>Cercant...</div>
                    ) : contactResults.length === 0 ? (
                      <div style={{ padding: '8px 12px', color: '#999', fontSize: 13 }}>Sense resultats</div>
                    ) : (
                      contactResults.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => { setSelectedContact(c); setContactSearch(''); setContactResults([]); }}
                          style={{
                            padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                            borderBottom: '1px solid var(--color-border)',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                        >
                          <strong>{contactDisplayName(c)}</strong>
                          {c.phoneE164 && <span style={{ color: '#999', marginLeft: 8 }}>{c.phoneE164}</span>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </Field>

          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, margin: '8px 0' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" onClick={onClose} style={secondaryBtn}>Cancel·lar</button>
            <button type="submit" disabled={loading} style={primaryBtn}>
              {loading ? 'Guardant...' : 'Crear deal'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#fff',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)', color: '#fff', border: 'none',
  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid var(--color-border)',
  padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
